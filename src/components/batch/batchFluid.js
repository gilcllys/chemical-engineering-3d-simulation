/**
 * batchFluid.js
 * SPH fluid simulation ported from Sebastian Lague's Fluid-Sim (Episode-01)
 * https://github.com/SebLague/Fluid-Sim/tree/Episode-01
 *
 * Ported from HLSL → JavaScript 3D.
 * Uses dual-density (density + nearDensity) and spatial hashing for O(N) neighbor lookup.
 *
 * Kernels (FluidMaths2D.hlsl → 3D extension):
 *   SpikyPow2  → density
 *   SpikyPow3  → near-density (prevents clustering)
 *   Poly6      → viscosity smoothing
 */

// ── Geometria do vaso (Three.js world-space) ─────────────────────────────────
export const VESSEL_R   = 0.88
export const Y_FLOOR    = -1.35
export const Y_FILL     = -0.08   // superfície livre (60% do vaso)
export const SPHERE_R   = 0.065   // raio visual
const IMPELLER_Y        = -0.55

// ── Parâmetros SPH (baseados nos valores do Lague, tunados para 3D) ──────────
const H                  = 0.28    // smoothingRadius
const H2                 = H * H
const TARGET_DENSITY     = 18.0    // targetDensity
const PRESSURE_MULT      = 600.0   // pressureMultiplier
const NEAR_PRESSURE_MULT = 100.0   // nearPressureMultiplier
const VISCOSITY          = 0.25    // viscosityStrength
const GRAVITY            = 9.8     // gravidade (m/s²)
const COLLISION_DAMPING  = 0.25    // restituição na parede (< 1 = absorve)

// ── Constantes dos kernels (3D) ───────────────────────────────────────────────
const PI = Math.PI
// SpikyPow2: 6 / (π × h⁴)
const SPIKY2_SCALE    =  6  / (PI * H  * H  * H  * H )
const SPIKY2_D_SCALE  = 12  / (PI * H  * H  * H  * H )
// SpikyPow3: 10 / (π × h⁵)
const SPIKY3_SCALE    = 10  / (PI * H2 * H2 * H )
const SPIKY3_D_SCALE  = 30  / (PI * H2 * H2 * H )
// Poly6: 4 / (π × h⁸)
const POLY6_SCALE     =  4  / (PI * H2 * H2 * H2 * H2)

// ── Kernels ───────────────────────────────────────────────────────────────────
function spikyPow2(dst)     { if (dst >= H) return 0; const v = H - dst; return v * v * SPIKY2_SCALE }
function spikyPow3(dst)     { if (dst >= H) return 0; const v = H - dst; return v * v * v * SPIKY3_SCALE }
function poly6(dst)         { if (dst >= H) return 0; const v = H2 - dst*dst; return v * v * v * POLY6_SCALE }
function dSpikyPow2(dst)    { if (dst >= H) return 0; return -(H - dst) * SPIKY2_D_SCALE }
function dSpikyPow3(dst)    { if (dst >= H) return 0; const v = H - dst; return -v * v * SPIKY3_D_SCALE }

// ── Spatial Hash 3D ──────────────────────────────────────────────────────────
function cellCoord(v) { return Math.floor(v / H) }
function hashCell(cx, cy, cz) { return (((cx * 15823) ^ (cy * 9737333) ^ (cz * 3853099)) >>> 0) }
function keyFromHash(hash, sz) { return hash % sz }

// ── Inicialização em grade regular ────────────────────────────────────────────
export function createFluidState(N = 500) {
  const particles = []
  const maxR = VESSEL_R - SPHERE_R

  // Grade hexagonal empilhada (mais densa que cúbica) — de baixo para cima
  const spacing = H * 0.72
  let placed = 0
  let row = 0

  outer:
  while (placed < N) {
    const y = Y_FLOOR + SPHERE_R * 2 + row * spacing * 0.88
    if (y > Y_FILL - SPHERE_R) break
    let col = 0
    while (placed < N) {
      const angle  = col * (Math.PI * 0.618)   // espiral áurea → distribuição uniforme
      const r      = Math.sqrt((col + 0.5) / N) * maxR * 2.0
      const x      = Math.cos(angle) * Math.min(r, maxR)
      const z      = Math.sin(angle) * Math.min(r, maxR)
      if (x*x + z*z > maxR * maxR) { col++; if (col > N) break outer; continue }
      // pequeno jitter para evitar simetria perfeita
      const jx = (Math.random() - 0.5) * spacing * 0.18
      const jz = (Math.random() - 0.5) * spacing * 0.18
      particles.push({ x: x+jx, y, z: z+jz, vx:0, vy:0, vz:0,
                       density:TARGET_DENSITY, nearDensity:0,
                       pressure:0, nearPressure:0,
                       px:0, py:0, pz:0,           // predicted position
                       noise: (Math.random()-0.5)*0.28 })
      placed++; col++
    }
    row++
  }
  // preenche restantes se necessário
  while (particles.length < N) {
    let x, z
    do { x=(Math.random()*2-1)*maxR; z=(Math.random()*2-1)*maxR } while(x*x+z*z>maxR*maxR)
    const y = Y_FLOOR + SPHERE_R + Math.random()*(Y_FILL-Y_FLOOR-SPHERE_R*2)
    particles.push({x,y,z,vx:0,vy:0,vz:0,density:TARGET_DENSITY,nearDensity:0,
                    pressure:0,nearPressure:0,px:0,py:0,pz:0,noise:(Math.random()-0.5)*0.28})
  }

  // Aloca arrays para hash espacial
  const tableSize = N * 4
  return {
    particles,
    tableSize,
    spatialKeys:    new Int32Array(N),    // hash key de cada partícula
    sortedIndices:  new Int32Array(N),    // partículas ordenadas por hash key
    cellStart:      new Int32Array(tableSize).fill(-1),  // início de cada célula
    cellCount:      new Int32Array(tableSize),
  }
}

// ── Reconstrução da tabela hash ───────────────────────────────────────────────
function rebuildSpatialHash(state) {
  const { particles: pts, tableSize, spatialKeys, sortedIndices, cellStart, cellCount } = state
  const N = pts.length

  // Reset
  cellCount.fill(0)
  cellStart.fill(-1)

  // Conta partículas por célula (usando posição predita)
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    const k = keyFromHash(hashCell(cellCoord(p.px), cellCoord(p.py), cellCoord(p.pz)), tableSize)
    spatialKeys[i] = k
    cellCount[k]++
  }
  // Prefix sum → início de cada célula
  let total = 0
  for (let k = 0; k < tableSize; k++) {
    cellStart[k] = total
    total += cellCount[k]
    cellCount[k] = 0   // reusa como contador de inserção
  }
  // Preenche sortedIndices
  for (let i = 0; i < N; i++) {
    const k = spatialKeys[i]
    sortedIndices[cellStart[k] + cellCount[k]] = i
    cellCount[k]++
  }
}

// ── Iterador de vizinhos ───────────────────────────────────────────────────────
const _offsets3D = []
for (let ox=-1; ox<=1; ox++) for (let oy=-1; oy<=1; oy++) for (let oz=-1; oz<=1; oz++)
  _offsets3D.push(ox, oy, oz)

function forEachNeighbor(state, px, py, pz, callback) {
  const { particles: pts, tableSize, sortedIndices, cellStart, cellCount } = state
  const cx = cellCoord(px), cy = cellCoord(py), cz = cellCoord(pz)
  for (let o = 0; o < _offsets3D.length; o += 3) {
    const k = keyFromHash(hashCell(cx+_offsets3D[o], cy+_offsets3D[o+1], cz+_offsets3D[o+2]), tableSize)
    if (cellStart[k] < 0) continue
    const end = cellStart[k] + cellCount[k]
    for (let s = cellStart[k]; s < end; s++) {
      callback(pts[sortedIndices[s]], sortedIndices[s])
    }
  }
}

// ── Passo de simulação SPH (6 passes — Lague) ────────────────────────────────
export function stepFluid(state, dt, agitatorSpeed) {
  const pts = state.particles
  const N   = pts.length
  const sDt = Math.min(dt, 1/60)

  // ── Pass 1: External forces + predict positions (Lague: ExternalForces) ───
  for (let i = 0; i < N; i++) {
    const p = pts[i]

    // Gravidade
    p.vy -= GRAVITY * sDt

    // Agitador: campo de velocidade toroidal (tangencial + circulação axial)
    if (agitatorSpeed > 0.01) {
      const r  = Math.sqrt(p.x*p.x + p.z*p.z) + 1e-6
      const rn = Math.min(r / VESSEL_R, 1)
      const tx = -p.z/r, tz = p.x/r
      const vTarg = agitatorSpeed * 3.5 * r
      const blend = Math.min(0.9, agitatorSpeed * 5 * sDt)
      p.vx += (tx * vTarg - p.vx) * blend * 0.45
      p.vz += (tz * vTarg - p.vz) * blend * 0.45
      // Circulação axial Rushton
      const dyImp = p.y - IMPELLER_Y
      const axial = agitatorSpeed * 2.2 * (0.55 - rn) * (dyImp >= 0 ? 1 : -1)
      p.vy += axial * sDt * 5
    }

    // Predict position (Lague usa 1/120; usamos sDt/2 para estabilidade)
    p.px = p.x + p.vx * sDt * 0.5
    p.py = p.y + p.vy * sDt * 0.5
    p.pz = p.z + p.vz * sDt * 0.5
  }

  // ── Pass 2: Rebuild spatial hash (sobre posições preditas) ────────────────
  rebuildSpatialHash(state)

  // ── Pass 3: Calculate densities ───────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    let density = 0, nearDensity = 0
    forEachNeighbor(state, p.px, p.py, p.pz, (q) => {
      const dx = q.px-p.px, dy = q.py-p.py, dz = q.pz-p.pz
      const dst = Math.sqrt(dx*dx+dy*dy+dz*dz)
      density     += spikyPow2(dst)
      nearDensity += spikyPow3(dst)
    })
    p.density    = density
    p.nearDensity = nearDensity
    p.pressure    = Math.max(-TARGET_DENSITY, p.density - TARGET_DENSITY) * PRESSURE_MULT
    p.nearPressure = p.nearDensity * NEAR_PRESSURE_MULT
  }

  // ── Pass 4: Pressure force ─────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    let fx = 0, fy = 0, fz = 0
    forEachNeighbor(state, p.px, p.py, p.pz, (q) => {
      if (q === p) return
      const dx = q.px-p.px, dy = q.py-p.py, dz = q.pz-p.pz
      const dst2 = dx*dx+dy*dy+dz*dz
      if (dst2 >= H2 || dst2 < 1e-9) return
      const dst = Math.sqrt(dst2)
      const inv = 1/dst
      const nx = dx*inv, ny = dy*inv, nz = dz*inv
      // Shared pressure (average of both particles)
      const pressureShared    = (p.pressure     + q.pressure    ) / (2 * Math.max(q.density,    0.001))
      const nearPressureShared = (p.nearPressure + q.nearPressure) / (2 * Math.max(q.nearDensity,0.001))
      const grad2 = dSpikyPow2(dst)
      const grad3 = dSpikyPow3(dst)
      const totalGrad = pressureShared * grad2 + nearPressureShared * grad3
      fx += totalGrad * nx
      fy += totalGrad * ny
      fz += totalGrad * nz
    })
    const invD = 1 / Math.max(p.density, 0.001)
    p.vx += fx * invD * sDt
    p.vy += fy * invD * sDt
    p.vz += fz * invD * sDt
  }

  // ── Pass 5: Viscosity ─────────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    let vx = 0, vy = 0, vz = 0
    forEachNeighbor(state, p.px, p.py, p.pz, (q) => {
      if (q === p) return
      const dx = q.px-p.px, dy = q.py-p.py, dz = q.pz-p.pz
      const dst = Math.sqrt(dx*dx+dy*dy+dz*dz)
      const w = poly6(dst)
      vx += (q.vx - p.vx) * w
      vy += (q.vy - p.vy) * w
      vz += (q.vz - p.vz) * w
    })
    p.vx += vx * VISCOSITY * sDt
    p.vy += vy * VISCOSITY * sDt
    p.vz += vz * VISCOSITY * sDt
  }

  // ── Pass 6: Integrate positions + boundary collisions ─────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    p.x += p.vx * sDt
    p.y += p.vy * sDt
    p.z += p.vz * sDt

    // Parede cilíndrica
    const r2 = p.x*p.x + p.z*p.z
    const maxR = VESSEL_R - SPHERE_R
    if (r2 > maxR * maxR) {
      const r  = Math.sqrt(r2)
      p.x = p.x/r * maxR; p.z = p.z/r * maxR
      const nx = p.x/maxR, nz = p.z/maxR
      const vr = p.vx*nx + p.vz*nz
      if (vr > 0) {
        p.vx -= (1 + COLLISION_DAMPING) * vr * nx
        p.vz -= (1 + COLLISION_DAMPING) * vr * nz
      }
    }
    // Fundo
    if (p.y < Y_FLOOR + SPHERE_R) {
      p.y = Y_FLOOR + SPHERE_R
      if (p.vy < 0) p.vy = Math.abs(p.vy) * COLLISION_DAMPING
    }
    // Superfície livre
    if (p.y > Y_FILL - SPHERE_R) {
      p.y = Y_FILL - SPHERE_R
      if (p.vy > 0) p.vy = -Math.abs(p.vy) * COLLISION_DAMPING
    }
  }
}
