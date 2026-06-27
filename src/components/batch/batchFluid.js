/**
 * batchFluid.js — SPH (Smoothed Particle Hydrodynamics) para Reator Batelada
 *
 * Inspirado em oimo.io/works/water3d — física de líquido real:
 *   · Incompressibilidade: repulsão forte quando partículas se sobrepõem
 *   · Tensão superficial / coesão: partículas se atraem suavemente quando
 *     ligeiramente separadas → massa líquida coesa (não dispersa como gás)
 *   · Viscosidade: suavização de velocidade entre vizinhos
 *   · Campo de vórtice do agitador: fluxo toroidal (turbina Rushton)
 *   · Gravidade forte: superfície livre visível no fundo do vaso
 */

// ── Geometria do vaso ────────────────────────────────────────────────────────
export const VESSEL_R  = 0.88    // raio interior
export const Y_FLOOR   = -1.38   // fundo interno
export const Y_FILL    = -0.10   // nível da superfície livre (≈60% do vaso)
export const IMPELLER_Y = -0.55  // altura do impeller
export const SPHERE_R  = 0.072   // raio visual + colisão de cada partícula

// ── Parâmetros SPH ───────────────────────────────────────────────────────────
const H        = 0.26   // raio de suavização (cada partícula vê ~10-15 vizinhos)
const H2       = H * H
const MIN_DIST = SPHERE_R * 2.05  // distância mínima (sem sobreposição)

const GRAVITY  = 6.5    // gravidade (m/s²) — mantém o líquido no fundo
const REPULSE  = 120.0  // força de repulsão (incompressibilidade)
const COHESION = 30.0   // tensão superficial / coesão (mantém a massa coesa)
const VISC     = 12.0   // viscosidade (suavização de velocidade entre vizinhos)
const DAMPING  = 1.8    // amortecimento geral (s⁻¹)

// ── Inicialização ─────────────────────────────────────────────────────────────
export function createFluidState(N = 550) {
  const particles = []
  const maxR = VESSEL_R - SPHERE_R

  // Empilha partículas em camadas concêntricas, de baixo para cima
  // → garante distribuição densa e uniforme (sem rejeição aleatória)
  let placed = 0
  const yLevels = 22
  const rLevels = 6

  outer:
  for (let iy = 0; iy < yLevels && placed < N; iy++) {
    const y = Y_FLOOR + SPHERE_R * 2 + iy * (MIN_DIST * 0.97)
    if (y > Y_FILL - SPHERE_R) break

    for (let ir = 0; ir <= rLevels && placed < N; ir++) {
      const ringR = ir * (maxR / rLevels)
      const circumference = 2 * Math.PI * Math.max(ringR, 0.01)
      const nInRing = ir === 0 ? 1 : Math.max(1, Math.floor(circumference / (MIN_DIST * 0.97)))
      const angleOffset = iy * 0.31 + ir * 0.47  // offset por camada → sem alinhamento vertical

      for (let ia = 0; ia < nInRing && placed < N; ia++) {
        const angle = (ia / nInRing) * Math.PI * 2 + angleOffset
        const x = Math.cos(angle) * ringR
        const z = Math.sin(angle) * ringR
        // jitter pequeno para evitar cristalização
        const jx = (Math.random() - 0.5) * MIN_DIST * 0.15
        const jz = (Math.random() - 0.5) * MIN_DIST * 0.15
        particles.push({
          x: x + jx, y, z: z + jz,
          vx: 0, vy: 0, vz: 0,
          noise: (Math.random() - 0.5) * 0.28,
        })
        placed++
      }
    }
  }

  // Preenche restantes aleatoriamente se necessário
  while (particles.length < N) {
    let x, z
    do { x = (Math.random() * 2 - 1) * maxR; z = (Math.random() * 2 - 1) * maxR }
    while (x*x + z*z > maxR*maxR)
    const y = Y_FLOOR + SPHERE_R + Math.random() * (Y_FILL - Y_FLOOR - SPHERE_R*2)
    particles.push({ x, y, z, vx:0, vy:0, vz:0, noise:(Math.random()-0.5)*0.28 })
  }

  return { particles }
}

// ── Passo de física SPH ────────────────────────────────────────────────────────
export function stepFluid(state, dt, agitatorSpeed) {
  const pts  = state.particles
  const N    = pts.length
  const sDt  = Math.min(dt, 1 / 60)

  // ── 1. Forças de campo: gravidade + agitador ───────────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]

    // Gravidade
    p.vy -= GRAVITY * sDt

    // Campo de velocidade do agitador (vórtice + circulação axial)
    if (agitatorSpeed > 0.01) {
      const r = Math.sqrt(p.x*p.x + p.z*p.z) + 1e-6
      const rn = Math.min(r / VESSEL_R, 1)

      // Tangencial: velocidade alvo = ω × r (perfil sólido-rígido)
      const tx = -p.z / r
      const tz =  p.x / r
      const vTarg = agitatorSpeed * 3.2 * r
      const blend = Math.min(0.85, agitatorSpeed * 6 * sDt)
      p.vx += (tx * vTarg - p.vx) * blend * 0.5
      p.vz += (tz * vTarg - p.vz) * blend * 0.5

      // Circulação axial (Rushton): sobe no centro, desce pela parede
      const dyImp = p.y - IMPELLER_Y
      const axial = agitatorSpeed * 2.0 * (0.55 - rn) * (dyImp >= 0 ? 1 : -1)
      p.vy += axial * sDt * 5
    }

    // Amortecimento viscoso global
    p.vx *= 1 - DAMPING * sDt
    p.vy *= 1 - DAMPING * sDt * 0.6
    p.vz *= 1 - DAMPING * sDt
  }

  // ── 2. SPH: repulsão + coesão + viscosidade entre pares ────────────────────
  for (let i = 0; i < N; i++) {
    const a = pts[i]
    for (let j = i + 1; j < N; j++) {
      const b   = pts[j]
      const dx  = b.x - a.x
      const dy  = b.y - a.y
      const dz  = b.z - a.z
      // Early-out AABB rápido (evita sqrt desnecessário)
      if (dx > H || dx < -H || dy > H || dy < -H || dz > H || dz < -H) continue
      const r2  = dx*dx + dy*dy + dz*dz
      if (r2 >= H2 || r2 < 1e-9) continue

      const r   = Math.sqrt(r2)
      const inv = 1 / r
      const nx  = dx * inv, ny = dy * inv, nz = dz * inv

      if (r < MIN_DIST) {
        // ── Repulsão (incompressibilidade) ─────────────────────────────────
        // Força proporcional ao quadrado da sobreposição (mais suave que linear)
        const overlap = (MIN_DIST - r) / MIN_DIST
        const f = REPULSE * overlap * overlap
        const ix = nx * f * sDt, iy = ny * f * sDt, iz = nz * f * sDt
        a.vx -= ix; a.vy -= iy; a.vz -= iz
        b.vx += ix; b.vy += iy; b.vz += iz

      } else {
        // ── Coesão / tensão superficial ────────────────────────────────────
        // Partículas ligeiramente separadas se atraem → massa coesa como água
        // Kernel em sino: pico a r = MIN_DIST + (H - MIN_DIST)/2
        const t  = (r - MIN_DIST) / (H - MIN_DIST)     // 0..1
        const f  = COHESION * t * (1 - t) * 4           // bell curve, max=COHESION
        const ix = nx * f * sDt, iy = ny * f * sDt, iz = nz * f * sDt
        a.vx += ix; a.vy += iy; a.vz += iz
        b.vx -= ix; b.vy -= iy; b.vz -= iz
      }

      // ── Viscosidade (XSPH: suaviza velocidade com vizinhos) ────────────────
      const w    = VISC * (1 - r / H)       // kernel linear
      const dvx  = (b.vx - a.vx) * w * sDt
      const dvy  = (b.vy - a.vy) * w * sDt
      const dvz  = (b.vz - a.vz) * w * sDt
      a.vx += dvx; a.vy += dvy; a.vz += dvz
      b.vx -= dvx; b.vy -= dvy; b.vz -= dvz
    }
  }

  // ── 3. Integrar posições + restrições de fronteira ─────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]

    p.x += p.vx * sDt
    p.y += p.vy * sDt
    p.z += p.vz * sDt

    // Parede cilíndrica (reflexão radial, baixa restituição)
    const r2  = p.x*p.x + p.z*p.z
    const maxR = VESSEL_R - SPHERE_R
    if (r2 > maxR * maxR) {
      const r  = Math.sqrt(r2)
      p.x = p.x / r * maxR
      p.z = p.z / r * maxR
      const nx  = p.x / maxR, nz = p.z / maxR
      const vr  = p.vx * nx + p.vz * nz
      if (vr > 0) { p.vx -= vr * nx * 1.85; p.vz -= vr * nz * 1.85 }
    }

    // Fundo
    if (p.y < Y_FLOOR + SPHERE_R) {
      p.y  = Y_FLOOR + SPHERE_R
      if (p.vy < 0) { p.vy = -p.vy * 0.05; p.vx *= 0.82; p.vz *= 0.82 }
    }

    // Superfície livre (topo do líquido)
    if (p.y > Y_FILL - SPHERE_R) {
      p.y  = Y_FILL - SPHERE_R
      if (p.vy > 0) p.vy = -p.vy * 0.04
    }
  }
}
