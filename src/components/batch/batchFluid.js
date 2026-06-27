/**
 * batchFluid.js
 * Simulação de líquido agitado para o Reator Batelada.
 *
 * Abordagem: campo de velocidade coerente (vórtice Rushton) + restrição de densidade.
 *
 * Comportamento alvo:
 *   - Partículas ocupam apenas 55% inferior do vaso (superfície livre visível)
 *   - Giram juntas em vórtice tangencial (como um liquidificador)
 *   - Circulação axial: sobe no centro, desce pela parede
 *   - Sem movimento aleatório individual — toda a massa se move coerentemente
 */

// ── Geometria do vaso (espaço 3D, mesmas medidas do modelo Three.js) ──────────
export const VESSEL_R = 0.88   // raio interior do cilindro
export const Y_FLOOR  = -1.35  // fundo do líquido
export const Y_TOP    = -0.05  // superfície livre (55% do vaso = Y_FLOOR + 2.5*0.55)
export const IMPELLER_Y = -0.5 // altura do impeller (turbina Rushton)
export const SPHERE_R = 0.058  // raio visual de cada partícula

const GRAVITY   = 4.2    // gravidade (mundo)
const DAMPING   = 2.8    // amortecimento viscoso (s⁻¹)
const MIN_DIST  = SPHERE_R * 2.1  // distância mínima entre partículas
const REPULSE   = 18.0   // força de repulsão (pressão)

// ── Inicialização ─────────────────────────────────────────────────────────────
export function createFluidState(N = 480) {
  const particles = []
  const maxR = VESSEL_R - SPHERE_R

  for (let i = 0; i < N; i++) {
    // Amostragem por rejeição: (x,z) dentro do cilindro
    let x, z
    do {
      x = (Math.random() * 2 - 1) * maxR
      z = (Math.random() * 2 - 1) * maxR
    } while (x * x + z * z > maxR * maxR)

    // y apenas na parte INFERIOR (55% do vaso) — superfície livre visível
    const y = Y_FLOOR + SPHERE_R + Math.random() * (Y_TOP - Y_FLOOR - SPHERE_R * 2)

    particles.push({
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      noise: (Math.random() - 0.5) * 0.25,  // offset de cor individual
    })
  }
  return { particles }
}

// ── Passo de física ───────────────────────────────────────────────────────────
export function stepFluid(state, dt, agitatorSpeed) {
  const pts  = state.particles
  const N    = pts.length
  const simDt = Math.min(dt, 1 / 60)

  // ── 1. Forças externas: gravidade + campo de velocidade do agitador ─────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]
    const r = Math.sqrt(p.x * p.x + p.z * p.z) + 1e-6
    const rNorm = r / VESSEL_R  // 0 (centro) → 1 (parede)

    // Gravidade
    p.vy -= GRAVITY * simDt

    if (agitatorSpeed > 0.01) {
      // ── Velocidade tangencial (vórtice) ──────────────────────────────
      // Direção tangencial: perpendicular a (x,z) no plano horizontal
      const tx = -p.z / r
      const tz =  p.x / r
      const vTang = agitatorSpeed * 1.8 * r  // proporcional ao raio (perfil sólido-rígido)

      // Impulsiona suavemente em direção à velocidade tangencial do vórtice
      const blend = Math.min(1, agitatorSpeed * 3.5 * simDt)
      p.vx += (tx * vTang - p.vx) * blend * 0.55
      p.vz += (tz * vTang - p.vz) * blend * 0.55

      // ── Circulação axial (turbina Rushton: sobe no centro, desce na parede) ─
      // Duas células de recirculação (acima e abaixo do impeller)
      const dy = p.y - IMPELLER_Y
      const axialSign = dy > 0 ? 1 : -1  // acima: sobe no centro; abaixo: desce no centro
      const axialV = agitatorSpeed * 0.9 * (0.5 - rNorm) * axialSign
      p.vy += axialV * simDt * 4.5
    }

    // ── Amortecimento viscoso ────────────────────────────────────────────────
    const damp = 1 - DAMPING * simDt
    p.vx *= damp
    p.vy *= damp
    p.vz *= damp
  }

  // ── 2. Restrição de densidade (partículas próximas se repelem) ──────────────
  // O(N²) com early-exit — mantém as partículas coesas sem se sobreporem
  for (let i = 0; i < N; i++) {
    const a = pts[i]
    for (let j = i + 1; j < N; j++) {
      const b = pts[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      if (Math.abs(dx) > MIN_DIST || Math.abs(dy) > MIN_DIST || Math.abs(dz) > MIN_DIST) continue
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= MIN_DIST * MIN_DIST || d2 < 1e-8) continue

      const d   = Math.sqrt(d2)
      const mag = (MIN_DIST - d) / d * REPULSE * simDt
      const fx  = dx * mag, fy = dy * mag, fz = dz * mag

      a.vx -= fx; a.vy -= fy; a.vz -= fz
      b.vx += fx; b.vy += fy; b.vz += fz
    }
  }

  // ── 3. Integração + restrições de fronteira ──────────────────────────────────
  for (let i = 0; i < N; i++) {
    const p = pts[i]

    p.x += p.vx * simDt
    p.y += p.vy * simDt
    p.z += p.vz * simDt

    // ── Parede cilíndrica ───────────────────────────────────────────────────
    const r2  = p.x * p.x + p.z * p.z
    const maxR = VESSEL_R - SPHERE_R
    if (r2 > maxR * maxR) {
      const r  = Math.sqrt(r2)
      // Projeta de volta para dentro
      p.x = p.x / r * maxR
      p.z = p.z / r * maxR
      // Cancela componente radial da velocidade (parede absorvente)
      const nx   = p.x / maxR
      const nz   = p.z / maxR
      const vRad = p.vx * nx + p.vz * nz
      if (vRad > 0) { p.vx -= vRad * nx * 1.85; p.vz -= vRad * nz * 1.85 }
    }

    // ── Fundo do vaso ───────────────────────────────────────────────────────
    if (p.y < Y_FLOOR + SPHERE_R) {
      p.y  = Y_FLOOR + SPHERE_R
      if (p.vy < 0) p.vy = Math.abs(p.vy) * 0.06
    }

    // ── Superfície livre (topo do líquido) — restrição suave ───────────────
    if (p.y > Y_TOP - SPHERE_R) {
      p.y  = Y_TOP - SPHERE_R
      if (p.vy > 0) p.vy = -Math.abs(p.vy) * 0.04
    }
  }
}
