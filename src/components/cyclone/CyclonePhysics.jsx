/**
 * CyclonePhysics.jsx
 *
 * Ciclo de vida das partículas:
 *  1. 'outer'          → entra tangencialmente, espiral DESCENDO pela parede exterior
 *  2. 'inner'          → partículas leves migram para o centro, espiral SUBINDO pelo vortex finder
 *  3. 'overflow_exit'  → saem pelo cano reto no topo → jet vertical com dispersão (Cartesiano)
 *  4. 'underflow_fall' → partículas pesadas caem pelo apex para a CAIXA coletora (Cartesiano)
 *  5. 'inlet'          → stream de entrada visível vindo da direita
 *
 * Physics patterns applied:
 *  - Force-based integration (v += F·dt, p += v·dt) for outer/inner vortex phases
 *  - Velocity damping per step (v *= 1 - damp·dt) instead of lerp clamping
 *  - Speed clamping to prevent numerical explosion
 *  - Example 2 floor-bounce pattern for underflow_fall (sand restitution + friction)
 *  - Clean pipe-jet model for overflow_exit (constrained inside pipe, free above)
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// ── Paleta acessível para daltônicos (Paul Tol) ─────────────────────
const COL = {
  veryFine:   new THREE.Color('#0077BB'),
  fine:       new THREE.Color('#33BBEE'),
  medium:     new THREE.Color('#EE7733'),
  coarse:     new THREE.Color('#CC3311'),
  veryCoarse: new THREE.Color('#EE3377'),
  inlet:      new THREE.Color('#888888'),
  overflow:   new THREE.Color('#88CCEE'),
  underflow:  new THREE.Color('#AA4400'),
}

function particleColor(dp) {
  if (dp < 5)  return COL.veryFine
  if (dp < 15) return COL.fine
  if (dp < 30) return COL.medium
  if (dp < 60) return COL.coarse
  return COL.veryCoarse
}

// Raio da parede em y no world space (y=0 = junção cone/cilindro)
function wallRAt(y, R, coneH, cylH) {
  if (y >= 0 && y <= cylH) return R
  if (y < 0) {
    const t = Math.min(-y / coneH, 1.0)
    return R * (1 - t) + 0.045 * t
  }
  return R
}

// Converte coordenadas polares para cartesianas (para transição de fase)
function toCar(p) {
  const cosA = Math.cos(p.angle), sinA = Math.sin(p.angle)
  p.x  = cosA * p.r
  p.z  = sinA * p.r
  p.vx = p.vr * cosA - p.r * p.omega * sinA
  p.vz = p.vr * sinA + p.r * p.omega * cosA
}

// ── Fábricas de partículas ──────────────────────────────────────────

function makeActive(params, forceSmall = false) {
  const { cylinderRadius, cylinderHeight, inletVelocity, particleSize } = params
  const dp = forceSmall
    ? 2 + Math.random() * 13
    : Math.max(2, particleSize * (0.4 + Math.random() * 1.3))
  const isHeavy    = dp >= 25
  const sizeFactor = Math.min(dp / 60, 1.0)
  const r          = cylinderRadius * (0.82 + Math.random() * 0.14)
  const angle      = (Math.random() - 0.5) * 0.5  // próximo do ângulo 0 (lado direito = inlet)
  const y          = cylinderHeight * (0.58 + Math.random() * 0.34)
  const speed      = inletVelocity * (0.75 + Math.random() * 0.5)

  return {
    dp, sizeFactor, isHeavy,
    r, angle, y,
    vr: -speed * 0.03,
    vy: -speed * (0.10 + sizeFactor * 0.12),
    omega: -speed / Math.max(r, 0.04),
    phase: 'outer',
    sphereR: Math.max(0.013, dp * 0.00058),
    color: particleColor(dp),
    alive: true,
  }
}

function makeInletStream(params) {
  const { cylinderRadius, cylinderHeight, inletVelocity } = params
  const spread = (Math.random() - 0.5) * 0.28
  return {
    dp: 8 + Math.random() * 15,
    sizeFactor: 0.3,
    r: cylinderRadius * (1.05 + Math.random() * 0.22),
    angle: 0.04 + spread,
    y: cylinderHeight * (0.70 + Math.random() * 0.20),
    vr: -inletVelocity * 0.55,
    vy: -inletVelocity * 0.03,
    omega: -inletVelocity / cylinderRadius * 0.90,
    phase: 'inlet',
    sphereR: 0.018,
    color: COL.inlet,
    alive: true,
    ttl: 0.30 + Math.random() * 0.22,
    age: 0,
  }
}

function makeOverflowStream(params) {
  const { cylinderHeight, cylinderRadius, inletVelocity } = params
  const vR     = cylinderRadius * 0.35
  const spread = (Math.random() - 0.5) * vR * 0.75
  return {
    x: spread,
    z: (Math.random() - 0.5) * vR * 0.75,
    y: cylinderHeight - 0.04 + Math.random() * 0.06,
    vx: spread * 0.25,
    vy: inletVelocity * (0.50 + Math.random() * 0.30),
    vz: (Math.random() - 0.5) * 0.25,
    phase: 'overflow_exit',
    sphereR: 0.015 + Math.random() * 0.013,
    color: COL.overflow,
    alive: true,
    ttl: 2.8 + Math.random() * 1.8,
    age: 0,
  }
}

// ── Constantes ────────────────────────────────────────────────────────
const MAX   = 2500
const dummy = new THREE.Object3D()

// ── MLS-MPM Fluid Simulation ──────────────────────────────────────────
const FLUID_GRID   = 32
const STIFFNESS    = 20.0
const REST_DENSITY = 3.5
const VISCOSITY    = 0.08
const FLUID_GRAV   = -96.0 / FLUID_GRID

// Pre-allocated grid: 32^3 × 4 floats = 131,072 floats
// Layout per cell: [vx, vy, vz, mass]
const fluidGrid = new Float32Array(FLUID_GRID * FLUID_GRID * FLUID_GRID * 4)

/**
 * simulateFluid — one MLS-MPM step for all active underflow_fall particles.
 * Runs 5 passes: clear → P2G-1 (momentum) → P2G-2 (stress) → grid update → G2P.
 * Modifies p.x/y/z, p.vx/vy/vz, p.C, and p.settled in-place.
 *
 * Velocity convention: p.vx/vy/vz are stored in GRID-SPACE (≈ 32× world-normalized).
 * They are divided by GRID before integrating world-space positions.
 */
function simulateFluid(pool, dt, coneHeight, fillLevelRef, fillPerPart) {
  const GRID    = FLUID_GRID
  const GRID2   = GRID * GRID
  const BOX_FLOOR  = -(coneHeight) - 2.49   // fluid-domain floor (slightly above visual floor)
  const BOX_TOP    = -(coneHeight) - 0.55
  const BOX_W      = 1.74                    // x/z world width (0.87 * 2)
  const BOX_H      = BOX_TOP - BOX_FLOOR     // y world height
  const BOX_HALF   = 0.87
  const FILL_HEIGHT = BOX_H

  // Filter active fluid particles (non-settled underflow_fall)
  const particles = pool.filter(p => p.phase === 'underflow_fall' && !p.settled)
  const N = particles.length
  if (N === 0) return

  const simDt = Math.min(dt, 1 / 45)

  // ── PASS 1: Clear grid ──────────────────────────────────────────────
  fluidGrid.fill(0)

  // Pre-compute per-particle B-spline data once (reused in passes 2, 3, 5)
  const pdata = new Array(N)
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const gx = ((p.x + BOX_HALF) / BOX_W) * GRID
    const gy = ((p.y - BOX_FLOOR) / BOX_H) * GRID
    const gz = ((p.z + BOX_HALF) / BOX_W) * GRID

    const fx = Math.floor(gx), fy = Math.floor(gy), fz = Math.floor(gz)
    const dx = gx - fx - 0.5
    const dy = gy - fy - 0.5
    const dz = gz - fz - 0.5

    pdata[pi] = {
      gx, gy, gz,
      cx0: fx - 1, cy0: fy - 1, cz0: fz - 1,
      wx: [0.5 * (0.5 - dx) ** 2,  0.75 - dx * dx,  0.5 * (0.5 + dx) ** 2],
      wy: [0.5 * (0.5 - dy) ** 2,  0.75 - dy * dy,  0.5 * (0.5 + dy) ** 2],
      wz: [0.5 * (0.5 - dz) ** 2,  0.75 - dz * dz,  0.5 * (0.5 + dz) ** 2],
    }
  }

  // ── PASS 2: P2G-1 — scatter momentum (velocity × mass) to grid ─────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]
    const C  = p.C
    const vx = p.vx, vy = p.vy, vz = p.vz

    for (let nx2 = 0; nx2 < 3; nx2++) {
      for (let ny2 = 0; ny2 < 3; ny2++) {
        for (let nz2 = 0; nz2 < 3; nz2++) {
          const gcx = cx0 + nx2, gcy = cy0 + ny2, gcz = cz0 + nz2
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue

          const w   = wx[nx2] * wy[ny2] * wz[nz2]
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz

          // APIC affine correction: Q = C · cellDist
          const qx = C[0]*cdx + C[1]*cdy + C[2]*cdz
          const qy = C[3]*cdx + C[4]*cdy + C[5]*cdz
          const qz = C[6]*cdx + C[7]*cdy + C[8]*cdz

          const ptr = (gcx * GRID2 + gcy * GRID + gcz) * 4
          fluidGrid[ptr]     += w * (vx + qx)  // momentum x
          fluidGrid[ptr + 1] += w * (vy + qy)  // momentum y
          fluidGrid[ptr + 2] += w * (vz + qz)  // momentum z
          fluidGrid[ptr + 3] += w              // mass
        }
      }
    }
  }

  // ── PASS 3: P2G-2 — scatter stress (pressure + viscosity) ──────────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]
    const C  = p.C

    // Gather local density from the 27 neighbour cells
    let density = 0
    for (let nx2 = 0; nx2 < 3; nx2++) {
      for (let ny2 = 0; ny2 < 3; ny2++) {
        for (let nz2 = 0; nz2 < 3; nz2++) {
          const gcx = cx0+nx2, gcy = cy0+ny2, gcz = cz0+nz2
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue
          const w   = wx[nx2] * wy[ny2] * wz[nz2]
          density  += fluidGrid[(gcx*GRID2 + gcy*GRID + gcz)*4 + 3] * w
        }
      }
    }

    // Equation-of-state pressure  (density/rest)^5 − 1, clamped ≥ 0
    const ratio    = density / REST_DENSITY
    const r2       = ratio * ratio
    const pressure = Math.max(0, (r2 * r2 * ratio - 1) * STIFFNESS)
    const volume   = density > 0 ? 1.0 / density : 0

    // Stress tensor  S = −P·I + ν·(C + Cᵀ)
    const S0 = -pressure + VISCOSITY * (C[0] + C[0])
    const S1 =             VISCOSITY * (C[1] + C[3])
    const S2 =             VISCOSITY * (C[2] + C[6])
    const S3 =             VISCOSITY * (C[3] + C[1])
    const S4 = -pressure + VISCOSITY * (C[4] + C[4])
    const S5 =             VISCOSITY * (C[5] + C[7])
    const S6 =             VISCOSITY * (C[6] + C[2])
    const S7 =             VISCOSITY * (C[7] + C[5])
    const S8 = -pressure + VISCOSITY * (C[8] + C[8])

    const term = volume * (-4.0) * simDt   // eq-16 prefactor

    for (let nx2 = 0; nx2 < 3; nx2++) {
      for (let ny2 = 0; ny2 < 3; ny2++) {
        for (let nz2 = 0; nz2 < 3; nz2++) {
          const gcx = cx0+nx2, gcy = cy0+ny2, gcz = cz0+nz2
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue
          const w   = wx[nx2] * wy[ny2] * wz[nz2]
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz
          const wt  = w * term
          const ptr = (gcx*GRID2 + gcy*GRID + gcz) * 4
          fluidGrid[ptr]     += (S0*cdx + S1*cdy + S2*cdz) * wt
          fluidGrid[ptr + 1] += (S3*cdx + S4*cdy + S5*cdz) * wt
          fluidGrid[ptr + 2] += (S6*cdx + S7*cdy + S8*cdz) * wt
        }
      }
    }
  }

  // ── PASS 4: Normalize grid momentum → velocity, gravity, hard walls ─
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      for (let k = 0; k < GRID; k++) {
        const ptr  = (i*GRID2 + j*GRID + k) * 4
        const mass = fluidGrid[ptr + 3]
        if (mass <= 0) continue

        fluidGrid[ptr]     /= mass           // vx = px / m
        fluidGrid[ptr + 1] /= mass           // vy = py / m
        fluidGrid[ptr + 2] /= mass           // vz = pz / m
        fluidGrid[ptr + 1] += FLUID_GRAV * simDt  // gravity

        // Hard-wall boundary: zero normal velocity at grid edges
        if (i < 1 || i > GRID - 2) fluidGrid[ptr]     = 0
        if (j < 1 || j > GRID - 2) fluidGrid[ptr + 1] = 0
        if (k < 1 || k > GRID - 2) fluidGrid[ptr + 2] = 0
      }
    }
  }

  // ── PASS 5: G2P — gather velocity from grid back to particles ───────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]

    let newVx = 0, newVy = 0, newVz = 0
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0, b7=0, b8=0

    for (let nx2 = 0; nx2 < 3; nx2++) {
      for (let ny2 = 0; ny2 < 3; ny2++) {
        for (let nz2 = 0; nz2 < 3; nz2++) {
          const gcx = cx0+nx2, gcy = cy0+ny2, gcz = cz0+nz2
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue

          const w   = wx[nx2] * wy[ny2] * wz[nz2]
          const ptr = (gcx*GRID2 + gcy*GRID + gcz) * 4
          const gvx = fluidGrid[ptr]
          const gvy = fluidGrid[ptr + 1]
          const gvz = fluidGrid[ptr + 2]

          newVx += w * gvx
          newVy += w * gvy
          newVz += w * gvz

          // APIC: accumulate outer product  B += w · gv ⊗ cellDist
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz
          b0 += w*gvx*cdx;  b1 += w*gvx*cdy;  b2 += w*gvx*cdz
          b3 += w*gvy*cdx;  b4 += w*gvy*cdy;  b5 += w*gvy*cdz
          b6 += w*gvz*cdx;  b7 += w*gvz*cdy;  b8 += w*gvz*cdz
        }
      }
    }

    // Update APIC affine matrix C = 4 · B  (×4 for quadratic B-spline)
    const C = p.C
    C[0]=b0*4; C[1]=b1*4; C[2]=b2*4
    C[3]=b3*4; C[4]=b4*4; C[5]=b5*4
    C[6]=b6*4; C[7]=b7*4; C[8]=b8*4

    // Convert grid-space velocity → world-space for position integration
    const wvx = newVx / GRID
    const wvy = newVy / GRID
    const wvz = newVz / GRID

    p.x += wvx * simDt
    p.y += wvy * simDt
    p.z += wvz * simDt

    // Hard-wall clamp to box interior
    const sr = p.sphereR
    p.x = Math.max(-BOX_HALF + sr, Math.min(BOX_HALF - sr, p.x))
    p.y = Math.max(BOX_FLOOR  + sr, Math.min(BOX_TOP  - sr, p.y))
    p.z = Math.max(-BOX_HALF + sr, Math.min(BOX_HALF - sr, p.z))

    // Store velocity back in grid-space for next frame
    p.vx = newVx
    p.vy = newVy
    p.vz = newVz

    // Settle check: very slow and near the floor → mark as settled
    const speed = Math.sqrt(newVx*newVx + newVy*newVy + newVz*newVz)
    if (speed < 0.5 && p.y < BOX_FLOOR + FILL_HEIGHT * 0.15) {
      p.settled = true
      if (fillLevelRef.current !== null) {
        fillLevelRef.current = Math.min(BOX_TOP - 0.02, fillLevelRef.current + fillPerPart)
      }
    }
  }
}

export default function CyclonePhysics({ params, isRunning = true }) {
  const {
    cylinderRadius, cylinderHeight, coneHeight,
    inletVelocity, particleCount, particleSize,
  } = params

  const maxActive = Math.min(particleCount, 900)

  // Constantes derivadas (mesmas que CycloneModel usa)
  const vortexR   = cylinderRadius * 0.35
  const R_core    = cylinderRadius * 0.28
  const BEND_R    = Math.max(vortexR * 4.5, 0.28)
  const HORIZ_EXT = cylinderRadius + 1.6
  const PIPE_END  = BEND_R + HORIZ_EXT
  // Coordenadas world do fundo da caixa coletora
  const BOX_FLOOR       = -(coneHeight) - 2.52  // fundo da caixa (maior)
  const BOX_TOP         = -(coneHeight) - 0.55   // topo da caixa
  const BOX_HALF        = 0.87                   // metade interna (1.80/2 - parede)
  const FILL_HEIGHT     = BOX_TOP - BOX_FLOOR     // ≈ 1.97 unidades
  const FILL_PER_PART   = FILL_HEIGHT * 0.90 / 250 // incremento por partícula

  const meshRef   = useRef()
  const pool      = useRef([])
  const timers    = useRef({ spawn: 0, inlet: 0, over: 0 })
  const fillLevel = useRef(null)   // nível atual do pó na caixa (world y)

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 8), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }), [])

  // Limpa o pool quando parâmetros de geometria mudam ou ao resetar (mudança de key)
  useEffect(() => {
    pool.current = []
    timers.current = { spawn: 0, inlet: 0, over: 0 }
    fillLevel.current = -(coneHeight) - 2.52  // BOX_FLOOR (caixa maior)
  },
    [cylinderRadius, cylinderHeight, coneHeight, particleCount, particleSize])

  useFrame((_, delta) => {
    if (!meshRef.current) return
    if (!isRunning) {
      // Mantém o último frame congelado
      return
    }

    const dt  = Math.min(delta, 1 / 30)
    const T   = timers.current

    // ── Contagem de fases ─────────────────────────────────────────
    let nActive = 0, nUnder = 0, nOver = 0
    for (const p of pool.current) {
      if (p.phase === 'outer' || p.phase === 'inner') nActive++
      else if (p.phase === 'underflow_fall' && !p.settled) nUnder++
      else if (p.phase === 'overflow_exit')  nOver++
    }

    // ── Spawn de partículas ativas ─────────────────────────────────
    T.spawn += dt
    const spawnInterval = Math.max(0.010 / (inletVelocity / 15), 0.005)
    while (T.spawn >= spawnInterval && nActive < maxActive) {
      T.spawn -= spawnInterval
      pool.current.push(makeActive(params, Math.random() < 0.55))
      nActive++
    }
    if (T.spawn > spawnInterval) T.spawn = 0

    // ── Stream de entrada (sempre visível) ────────────────────────
    T.inlet += dt
    if (T.inlet >= 0.030 && pool.current.length < MAX - 10) {
      T.inlet = 0
      for (let k = 0; k < 6; k++) pool.current.push(makeInletStream(params))
    }

    // ── Stream de saída overflow (partículas leves direto pelo topo) ────
    T.over += dt
    if (T.over >= 0.020 && pool.current.length < MAX - 15) {
      T.over = 0
      const batch = Math.ceil(4 + inletVelocity / 8)
      for (let k = 0; k < batch; k++) pool.current.push(makeOverflowStream(params))
    }

    // ── Física (2 sub-steps para estabilidade) ─────────────────────
    const SUB = 2
    const sdt = dt / SUB

    for (let s = 0; s < SUB; s++) {
      for (const p of pool.current) {
        if (!p.alive) continue

        // TTL
        if (p.ttl !== undefined) {
          p.age += sdt
          if (p.age >= p.ttl) { p.alive = false; continue }
        }

        // ── FASE: Vórtice externo (espiral descendo) ───────────────
        if (p.phase === 'outer') {
          // Tangential: spring-like convergence to gas omega + damping
          const omegaGas   = -inletVelocity * 0.88 / Math.max(p.r, 0.04)
          const omegaForce = (omegaGas - p.omega) * 4.0
          p.omega += omegaForce * sdt
          p.omega *= (1 - 0.08 * sdt)  // tangential damping

          // Radial: centrifugal pushes heavy outward, inward gas drag pulls light inward
          const F_centrifugal = p.sizeFactor * p.omega * p.omega * p.r
          const F_drag_inward = (1 - p.sizeFactor) * 2.8 * (p.r / cylinderRadius)
          const F_radial      = F_centrifugal - F_drag_inward
          p.vr += F_radial * sdt
          p.vr *= (1 - 0.18 * sdt)  // radial damping

          // Clamp radial speed to prevent runaway
          const maxRadial = inletVelocity * 0.3
          p.vr = Math.max(-maxRadial, Math.min(maxRadial, p.vr))

          // Axial: gravity-like force downward (stronger for heavier particles)
          const F_axial = -inletVelocity * (0.18 + p.sizeFactor * 0.30)
          p.vy += (F_axial - p.vy) * 3.0 * sdt

          // Clamp omega and vy
          p.omega = Math.max(-inletVelocity * 3, Math.min(0, p.omega))
          const maxVy = inletVelocity * 1.5
          p.vy = Math.max(-maxVy, Math.min(maxVy, p.vy))

          // Leves que chegam ao núcleo → vórtice interno
          if (p.r < R_core && !p.isHeavy) {
            p.phase = 'inner'
            p.vr    = (Math.random() - 0.5) * 0.2
          }

          // Colisão com parede
          const wR = wallRAt(p.y, cylinderRadius, coneHeight, cylinderHeight) - p.sphereR
          if (wR > 0.01 && p.r >= wR) {
            p.r      = wR
            p.vr     = -Math.abs(p.vr) * 0.35
            p.vy    *= 0.70
            p.omega *= 0.82
          }

          // Saída pelo apex → caixa coletora
          if (p.y < -coneHeight + 0.20) {
            if (nUnder < 1000000 && Math.random() < 0.99) {
              toCar(p)
              p.phase   = 'underflow_fall'
              p.settled = false
              // Espalha pela caixa inteira: posição aleatória no topo da caixa
              p.x   = (Math.random() - 0.5) * BOX_HALF * 1.75
              p.z   = (Math.random() - 0.5) * BOX_HALF * 1.75
              p.y   = BOX_TOP - 0.08
              // Velocidade inicial em espaço de grade (MLS-MPM grid-space)
              p.vx  = (Math.random() - 0.5) * FLUID_GRID * 0.3
              p.vy  = -FLUID_GRID * 0.5
              p.vz  = (Math.random() - 0.5) * FLUID_GRID * 0.3
              p.C   = new Array(9).fill(0)   // APIC affine matrix, zero at entry
              p.color = new THREE.Color('#8B5E3C')  // warm brown liquid
              nUnder++
            } else {
              p.alive = false
            }
          }

        // ── FASE: Vórtice interno (espiral subindo) ────────────────
        } else if (p.phase === 'inner') {
          // Tangential: faster spin convergence (tighter vortex core)
          const omegaGas   = -inletVelocity * 1.15 / Math.max(p.r, 0.02)
          const omegaForce = (omegaGas - p.omega) * 6.0
          p.omega += omegaForce * sdt
          p.omega *= (1 - 0.10 * sdt)  // tangential damping

          // Radial: inward drag pulls toward central axis
          p.vr += -3.5 * p.r * sdt
          p.vr *= (1 - 0.22 * sdt)  // radial damping

          // Axial: upward pressure differential drives gas toward overflow
          const F_axial_up = inletVelocity * 0.58
          p.vy += (F_axial_up - p.vy) * 4.0 * sdt

          // Clamp omega and vy
          p.omega = Math.max(-inletVelocity * 3, Math.min(0, p.omega))
          const maxVy = inletVelocity * 1.5
          p.vy = Math.max(-maxVy, Math.min(maxVy, p.vy))

          // Saída pelo topo → jet vertical
          if (p.y > cylinderHeight - 0.05) {
            if (nOver < 350 && Math.random() < 0.92) {
              toCar(p)
              p.phase = 'overflow_exit'
              p.ttl   = 3.8 + Math.random() * 2.0
              p.age   = 0
              p.color = COL.overflow
              nOver++
            } else {
              p.alive = false
            }
          }

        // ── FASE: Stream de entrada ────────────────────────────────
        } else if (p.phase === 'inlet') {
          const omegaGas = -inletVelocity / Math.max(p.r, 0.04)
          p.omega += (omegaGas - p.omega) * Math.min(sdt * 6, 0.95)
          p.vr    *= 0.90
          // Quando chega à parede interna, converte para ativa
          if (p.r <= cylinderRadius * 0.72) {
            const a = makeActive(params)
            a.r = p.r; a.angle = p.angle; a.y = p.y
            a.vr = p.vr; a.vy = p.vy; a.omega = p.omega
            if (nActive < maxActive) { pool.current.push(a); nActive++ }
            p.alive = false
          }

        // ── FASE: Saída pelo topo — jet com dispersão ────────────────
        } else if (p.phase === 'overflow_exit') {
          const pipeSpeed = inletVelocity * 0.60
          // Região dentro do cano de saída
          const inPipe = p.y < cylinderHeight + 1.60

          if (inPipe) {
            // Dentro do cano: acelera até a velocidade do pipe, confina em x/z
            p.vy += (pipeSpeed - p.vy) * Math.min(sdt * 8, 0.95)
            p.vx  = (p.vx || 0) * (1 - sdt * 8)  // confinamento forte no pipe
            p.vz  = (p.vz || 0) * (1 - sdt * 8)
            p.x   = (p.x  || 0) * (1 - sdt * 5)
            p.z   = (p.z  || 0) * (1 - sdt * 5)
          } else {
            // Acima do pipe: jet livre com turbulência e desaceleração
            p.vy *= (1 - sdt * 2)  // desacelera no ar
            p.vx  = (p.vx || 0) + (Math.random() - 0.5) * sdt * 0.5  // turbulência leve
            p.vz  = (p.vz || 0) + (Math.random() - 0.5) * sdt * 0.5
          }

          p.x  = (p.x || 0) + (p.vx || 0) * sdt
          p.y += p.vy * sdt
          p.z  = (p.z || 0) + (p.vz || 0) * sdt

          if (p.y > cylinderHeight + 3.0) p.alive = false

        }

        // Integra ângulo + raio (fases polares)
        if (p.phase === 'outer' || p.phase === 'inner' || p.phase === 'inlet') {
          p.angle += p.omega * sdt
          p.r      = Math.max(0.008, p.r + p.vr * sdt)
          p.y     += p.vy * sdt
        }
      }
    }

    // ── Simulação de fluido MLS-MPM para partículas underflow ─────────
    simulateFluid(pool.current, dt, coneHeight, fillLevel, FILL_PER_PART)

    // ── Limpa partículas mortas ────────────────────────────────────
    pool.current = pool.current.filter(p => p.alive).slice(0, MAX)

    // ── Renderiza com InstancedMesh ────────────────────────────────
    const alive = pool.current
    meshRef.current.count = alive.length

    for (let i = 0; i < alive.length; i++) {
      const p  = alive[i]
      const isCart = p.phase === 'overflow_exit' || p.phase === 'underflow_fall'
      const wx = isCart ? (p.x || 0) : Math.cos(p.angle) * p.r
      const wz = isCart ? (p.z || 0) : Math.sin(p.angle) * p.r

      // Fade só para partículas com TTL; settled e underflow sem fade
      const hasTTL = p.ttl !== undefined && !p.settled
      const fade   = hasTTL ? Math.max(0, 1 - p.age / p.ttl) : 1
      const sR     = p.sphereR * (hasTTL ? (0.3 + fade * 0.7) : 1)

      dummy.position.set(wx, p.y, wz)
      dummy.scale.setScalar(sR)
      dummy.updateMatrix()

      meshRef.current.setMatrixAt(i, dummy.matrix)
      meshRef.current.setColorAt(i, p.color)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, MAX]} castShadow />
  )
}
