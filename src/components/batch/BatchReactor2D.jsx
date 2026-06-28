/**
 * BatchReactor2D.jsx — Reator Batelada 2D (pure-canvas, spatial hash, Verlet)
 *
 * Física: Verlet integration + spatial hash grid (4000+ partículas, sem Matter.js)
 * Agitação: força tangencial + radial aplicada per-frame (mesma lógica do integrate.wgsl 3D)
 * Cinética: Ca(t) = Ca0 · exp(−k·t)   k = Arrhenius(T)
 * Cor:  Velocidade (azul→amarelo→laranja) | Concentração (azul→vermelho)
 */

import { useRef, useEffect } from 'react'

// ── Canvas ────────────────────────────────────────────────────────────
const W = 500
const H = 660

// ── Vessel geometry (px) ──────────────────────────────────────────────
const VX = 80, VY = 70, VW = 340, VH = 440, VR = 50
const CX = VX + VW / 2   // 250
const CY = VY + VH / 2   // 290

// Impeller: positioned at 70% of vessel height (matches 3D IMPELLER_Y)
const IMP_Y   = VY + VH * 0.70    // ≈ 378
const IMP_R   = VW * 0.38         // ≈ 129px  (matches IMPELLER_R / REACTOR_R)
const SHAFT_R = 5                  // px

// Particle physics area (inside vessel walls)
const WALL_T  = 12   // wall thickness
const PIX_IN  = VX + WALL_T
const PIX_OUT = VX + VW - WALL_T
const PIY_IN  = VY + WALL_T
const PIY_OUT = VY + VH - WALL_T

// ── Kinetics constants ────────────────────────────────────────────────
const K_REF   = 0.005   // s⁻¹ at T_REF
const T_REF   = 350     // K
const EA_R    = 8000    // K  (Ea / R)
const SIM_SPD = 6       // simulation time multiplier (6× real time)

// ── Spatial hash cell size ────────────────────────────────────────────
const CELL = 12   // px — slightly larger than max particle diameter (8 px)

// ── Color helpers ─────────────────────────────────────────────────────
// Concentration mode: blue (#0077BB) → red (#CC3311)
function concColor(x) {
  const t = Math.max(0, Math.min(1, x))
  const r = Math.round(  0 + 204 * t)
  const g = Math.round(119 -  68 * t)
  const b = Math.round(187 - 170 * t)
  return `rgb(${r},${g},${b})`
}

// Velocity mode: multi-stop (blue→cyan→green→yellow→orange)
function velColor(v, vmax) {
  const t = Math.max(0, Math.min(1, v / vmax))
  // Same multi-stop as sphere.wgsl value_to_color()
  const stops = [
    [0,        0.4,        0.8],
    [35/256,   161/256,    165/256],
    [95/256,   254/256,    150/256],
    [243/256,  250/256,    49/256],
    [255/256,  165/256,    0],
  ]
  const seg = Math.min(Math.floor(t * 4), 3)
  const tt  = (t * 4) - seg
  const a   = stops[seg]
  const b   = stops[seg + 1]
  return `rgb(${Math.round((a[0] + (b[0] - a[0]) * tt) * 255)},${Math.round((a[1] + (b[1] - a[1]) * tt) * 255)},${Math.round((a[2] + (b[2] - a[2]) * tt) * 255)})`
}

// ── Rounded-rect path ─────────────────────────────────────────────────
function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Draw vessel, shaft, impeller, jacket ──────────────────────────────
function drawVessel(ctx, impAngle, jacketColor) {
  // Jacket bands (outside)
  ctx.save()
  for (let y = VY + 16; y < VY + VH - 16; y += 26) {
    ctx.fillStyle = jacketColor || 'rgba(238,119,51,0.55)'
    ctx.fillRect(VX - 16, y, 14, 14)
    ctx.fillRect(VX + VW + 2, y, 14, 14)
  }
  ctx.strokeStyle = 'rgba(238,119,51,0.35)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  rrPath(ctx, VX - 16, VY + 8, VW + 32, VH - 16, VR + 8)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#b45309'
  ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Jaqueta Térmica', VX - 8, VY + 4)
  ctx.restore()

  // Vessel body fill (semi-transparent liquid)
  ctx.save()
  rrPath(ctx, VX, VY, VW, VH, VR)
  ctx.fillStyle = 'rgba(58,140,200,0.09)'
  ctx.fill()
  ctx.restore()

  // Vessel outline
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth = 4
  rrPath(ctx, VX, VY, VW, VH, VR)
  ctx.stroke()
  ctx.restore()

  // Inlet pipe (top-left)
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(VX - 52, VY + 90)
  ctx.lineTo(VX + 2, VY + 90)
  ctx.stroke()
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(VX - 52, VY + 81)
  ctx.lineTo(VX - 52, VY + 99)
  ctx.stroke()
  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('← Entrada A', VX - 52, VY + 76)
  ctx.restore()

  // Outlet pipe (bottom-right)
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(VX + VW - 2, VY + VH - 90)
  ctx.lineTo(VX + VW + 52, VY + VH - 90)
  ctx.stroke()
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(VX + VW + 52, VY + VH - 99)
  ctx.lineTo(VX + VW + 52, VY + VH - 81)
  ctx.stroke()
  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Saída B →', VX + VW + 52, VY + VH - 76)
  ctx.restore()

  // Shaft
  ctx.save()
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = SHAFT_R * 2
  ctx.beginPath()
  ctx.moveTo(CX, VY - 18)
  ctx.lineTo(CX, IMP_Y)
  ctx.stroke()
  ctx.restore()

  // Motor block
  ctx.save()
  ctx.fillStyle = '#64748b'
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 1.5
  rrPath(ctx, CX - 16, VY - 42, 32, 24, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f1f5f9'
  ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('M', CX, VY - 26)
  ctx.restore()

  // Impeller hub
  ctx.save()
  ctx.beginPath()
  ctx.arc(CX, IMP_Y, 9, 0, Math.PI * 2)
  ctx.fillStyle = '#334155'
  ctx.fill()
  ctx.restore()

  // Impeller blades (4 blades, like Rushton turbine in 3D)
  ctx.save()
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 7
  ctx.lineCap = 'square'
  for (let i = 0; i < 4; i++) {
    const a = impAngle + (i * Math.PI) / 2
    ctx.beginPath()
    ctx.moveTo(CX - Math.cos(a) * IMP_R, IMP_Y - Math.sin(a) * IMP_R * 0.45)
    ctx.lineTo(CX + Math.cos(a) * IMP_R, IMP_Y + Math.sin(a) * IMP_R * 0.45)
    ctx.stroke()
  }
  ctx.restore()

  // Title
  ctx.save()
  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('⚗️  Reator Batelada', CX, VY - 48)
  ctx.restore()
}

// ── Draw stats bar ────────────────────────────────────────────────────
function drawStats(ctx, X, Ca, CB, t, k, T) {
  const bx = 50, by = VY + VH + 24, bw = W - 100, bh = 16

  ctx.save()
  ctx.fillStyle = '#e2e8f0'
  rrPath(ctx, bx, by, bw, bh, 8)
  ctx.fill()
  if (X > 0.001) {
    const fill = bw * Math.min(1, X)
    const g = ctx.createLinearGradient(bx, 0, bx + fill, 0)
    g.addColorStop(0, '#0077BB')
    g.addColorStop(1, '#CC3311')
    ctx.fillStyle = g
    rrPath(ctx, bx, by, fill, bh, 8)
    ctx.fill()
  }
  ctx.restore()

  // Labels
  ctx.save()
  ctx.font = 'bold 11px sans-serif'
  ctx.fillStyle = '#0077BB'
  ctx.textAlign = 'left'
  ctx.fillText('A → B', bx, by - 5)
  ctx.fillStyle = '#334155'
  ctx.textAlign = 'right'
  ctx.fillText(`Conversão X: ${(X * 100).toFixed(1)} %`, bx + bw, by - 5)
  ctx.restore()

  ctx.save()
  ctx.font = '11px monospace'
  ctx.fillStyle = '#0077BB'
  ctx.textAlign = 'left'
  ctx.fillText(`CA = ${Ca.toFixed(3)} mol/L`, bx, by + bh + 16)
  ctx.fillStyle = '#64748b'
  ctx.textAlign = 'center'
  ctx.fillText(`t = ${t.toFixed(1)} s  |  k = ${k.toFixed(4)} s⁻¹  |  T = ${T} K`, bx + bw / 2, by + bh + 16)
  ctx.fillStyle = '#CC3311'
  ctx.textAlign = 'right'
  ctx.fillText(`CB = ${CB.toFixed(3)} mol/L`, bx + bw, by + bh + 16)
  ctx.restore()
}

// ── Spatial Hash Grid (module-level — no React dependencies) ─────────
class SpatialGrid {
  constructor(cellSize) {
    this.cs    = cellSize
    this.cells = new Map()
  }

  _key(cx, cy) { return (cx & 0xFFFF) | ((cy & 0xFFFF) << 16) }

  clear() { this.cells.clear() }

  insert(i, x, y) {
    const cx = Math.floor(x / this.cs)
    const cy = Math.floor(y / this.cs)
    const k  = this._key(cx, cy)
    let cell = this.cells.get(k)
    if (!cell) { cell = []; this.cells.set(k, cell) }
    cell.push(i)
  }

  query(x, y, r) {
    const results = []
    const cx0 = Math.floor((x - r) / this.cs)
    const cy0 = Math.floor((y - r) / this.cs)
    const cx1 = Math.floor((x + r) / this.cs)
    const cy1 = Math.floor((y + r) / this.cs)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.cells.get(this._key(cx, cy))
        if (cell) for (const idx of cell) results.push(idx)
      }
    }
    return results
  }
}

// ── Main component ────────────────────────────────────────────────────
export default function BatchReactor2D({ isRunning = true, params = {} }) {
  const canvasRef   = useRef(null)
  const runRef      = useRef(isRunning)
  const paramsRef   = useRef(params)
  const impAngleRef = useRef(0)

  useEffect(() => { runRef.current    = isRunning }, [isRunning])
  useEffect(() => { paramsRef.current = params    }, [params])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId = null

    // ── Particle count ──────────────────────────────────────────────────
    const N = Math.max(500, Math.min(4000, paramsRef.current.particleCount ?? 4000))

    // ── Flat typed arrays (avoids GC pressure) ──────────────────────────
    const px     = new Float32Array(N)
    const py     = new Float32Array(N)
    const pvx    = new Float32Array(N)
    const pvy    = new Float32Array(N)
    const pr     = new Float32Array(N)
    const pnoise = new Float32Array(N)

    // ── Initialise particles uniformly inside vessel ────────────────────
    for (let i = 0; i < N; i++) {
      pr[i] = 2.5 + Math.random() * 1.5   // radius 2.5–4 px
      let x, y, tries = 0
      do {
        x = PIX_IN + pr[i] + Math.random() * (PIX_OUT - PIX_IN - pr[i] * 2)
        y = PIY_IN + pr[i] + Math.random() * (PIY_OUT - PIY_IN - pr[i] * 2)
        tries++
      } while (tries < 20)
      px[i]     = x
      py[i]     = y
      pvx[i]    = (Math.random() - 0.5) * 2
      pvy[i]    = (Math.random() - 0.5) * 2
      pnoise[i] = Math.random()
    }

    // ── Simulation state ────────────────────────────────────────────────
    let simTime = 0
    let Ca      = paramsRef.current.initialConc ?? 1.0
    const grid  = new SpatialGrid(CELL)

    // ── Physics step (Verlet + spatial hash) ────────────────────────────
    // Defined inside useEffect so it can read impAngleRef without stale closure.
    function stepPhysics(dt, agitSpeed) {
      const GRAVITY     = 0.25    // px/ms² (tune for visual feel)
      const DAMPING     = 0.992   // velocity damping per frame
      const RESTITUTION = 0.4

      // 1. Build spatial grid
      grid.clear()
      for (let i = 0; i < N; i++) grid.insert(i, px[i], py[i])

      // 2. Apply forces: gravity + impeller tangential/radial
      const impFade = IMP_R * 2.5
      for (let i = 0; i < N; i++) {
        // Gravity
        pvy[i] += GRAVITY * dt

        // Impeller influence zone
        const dx   = px[i] - CX
        const dy   = py[i] - IMP_Y
        const r    = Math.sqrt(dx * dx + dy * dy)
        const fade = Math.max(0, 1 - r / impFade)
        if (fade > 0 && r > 0.001) {
          const ang = Math.atan2(dy, dx)
          // Tangential (primary mixing)
          const tx = Math.cos(ang + Math.PI / 2)
          const ty = Math.sin(ang + Math.PI / 2)
          pvx[i] += tx * agitSpeed * 0.055 * fade * dt
          pvy[i] += ty * agitSpeed * 0.055 * fade * dt
          // Radial outward (Rushton-style)
          pvx[i] += (dx / r) * agitSpeed * 0.025 * fade * dt
          pvy[i] += (dy / r) * agitSpeed * 0.025 * fade * dt
        }
      }

      // 3. Integrate positions
      for (let i = 0; i < N; i++) {
        pvx[i] *= DAMPING
        pvy[i] *= DAMPING
        px[i]  += pvx[i] * dt
        py[i]  += pvy[i] * dt
      }

      // 4. Wall collision (rectangular vessel interior)
      for (let i = 0; i < N; i++) {
        const r = pr[i]
        if (px[i] - r < PIX_IN)  { px[i] = PIX_IN  + r; pvx[i] =  Math.abs(pvx[i]) * RESTITUTION }
        if (px[i] + r > PIX_OUT) { px[i] = PIX_OUT - r; pvx[i] = -Math.abs(pvx[i]) * RESTITUTION }
        if (py[i] - r < PIY_IN)  { py[i] = PIY_IN  + r; pvy[i] =  Math.abs(pvy[i]) * RESTITUTION }
        if (py[i] + r > PIY_OUT) { py[i] = PIY_OUT - r; pvy[i] = -Math.abs(pvy[i]) * RESTITUTION }
      }

      // 5. Particle-particle collision (via spatial grid)
      for (let i = 0; i < N; i++) {
        const neighbors = grid.query(px[i], py[i], pr[i] * 2 + 2)
        for (const j of neighbors) {
          if (j <= i) continue
          const dx      = px[j] - px[i]
          const dy      = py[j] - py[i]
          const dist2   = dx * dx + dy * dy
          const minDist = pr[i] + pr[j]
          if (dist2 < minDist * minDist && dist2 > 0.0001) {
            const dist    = Math.sqrt(dist2)
            const overlap = (minDist - dist) * 0.5
            const nx = dx / dist
            const ny = dy / dist
            // Positional separation
            px[i] -= nx * overlap
            py[i] -= ny * overlap
            px[j] += nx * overlap
            py[j] += ny * overlap
            // Velocity impulse along collision normal
            const relVx  = pvx[j] - pvx[i]
            const relVy  = pvy[j] - pvy[i]
            const dot    = relVx * nx + relVy * ny
            if (dot < 0) {
              const impulse = dot * RESTITUTION
              pvx[i] -= impulse * nx
              pvy[i] -= impulse * ny
              pvx[j] += impulse * nx
              pvy[j] += impulse * ny
            }
          }
        }
      }

      // 6. Impeller blade collision (4 blades, line-segment vs circle)
      const BLADE_HALF_W = 4   // visual half-width of blade stroke (px)
      for (let b = 0; b < 4; b++) {
        const ang = impAngleRef.current + (b * Math.PI / 2)
        const bx1 = CX
        const by1 = IMP_Y
        const bx2 = CX + Math.cos(ang) * IMP_R
        const by2 = IMP_Y + Math.sin(ang) * IMP_R * 0.45   // matches drawVessel y-scale

        const ex      = bx2 - bx1
        const ey      = by2 - by1
        const segLen2 = ex * ex + ey * ey
        if (segLen2 < 0.001) continue

        for (let i = 0; i < N; i++) {
          const r = pr[i] + BLADE_HALF_W
          // Project particle onto blade segment
          const t          = Math.max(0, Math.min(1, ((px[i] - bx1) * ex + (py[i] - by1) * ey) / segLen2))
          const closestX   = bx1 + t * ex
          const closestY   = by1 + t * ey
          const dx         = px[i] - closestX
          const dy         = py[i] - closestY
          const dist2      = dx * dx + dy * dy
          if (dist2 < r * r && dist2 > 0.0001) {
            const dist = Math.sqrt(dist2)
            const nx   = dx / dist
            const ny   = dy / dist
            // Push particle clear of blade
            px[i] = closestX + nx * r
            py[i] = closestY + ny * r
            // Add blade tangential velocity to particle (spinning blade effect)
            const bladeSpeed = agitSpeed * 2.5
            pvx[i] += -ny * bladeSpeed * 0.015
            pvy[i] +=  nx * bladeSpeed * 0.015
            // Reflect normal component
            const dotN = pvx[i] * nx + pvy[i] * ny
            if (dotN < 0) {
              pvx[i] -= dotN * nx * (1 + RESTITUTION)
              pvy[i] -= dotN * ny * (1 + RESTITUTION)
            }
          }
        }
      }
    }

    // ── Batched particle draw (group by color for fewer ctx state changes) ─
    function drawParticles(colorMode, Ca0, mixedness) {
      const buckets = new Map()   // colorStr → index[]

      for (let i = 0; i < N; i++) {
        let color
        if (colorMode === 'Velocidade') {
          const v = Math.sqrt(pvx[i] * pvx[i] + pvy[i] * pvy[i])
          color = velColor(v, 8)
        } else {
          // Each particle has a per-particle noise offset that fades as mixing improves
          const noiseAmp = (1 - mixedness) * 0.5
          const localX   = Math.max(0, Math.min(1, (1 - Ca / Ca0) + (pnoise[i] - 0.5) * noiseAmp))
          color = concColor(localX)
        }
        let bucket = buckets.get(color)
        if (!bucket) { bucket = []; buckets.set(color, bucket) }
        bucket.push(i)
      }

      for (const [color, indices] of buckets) {
        ctx.fillStyle = color
        ctx.beginPath()
        for (const idx of indices) {
          ctx.moveTo(px[idx] + pr[idx], py[idx])
          ctx.arc(px[idx], py[idx], pr[idx], 0, Math.PI * 2)
        }
        ctx.fill()
      }
    }

    // ── rAF loop ────────────────────────────────────────────────────────
    let lastTime = null

    function loop(ts) {
      if (!lastTime) lastTime = ts
      const dt = Math.min(ts - lastTime, 20)   // cap at 20 ms (spiral-of-death guard)
      lastTime = ts

      const p = paramsRef.current
      const {
        agitatorSpeed = 1.5,
        temperature   = 350,
        initialConc:  Ca0 = 1.0,
        colorMode     = 'Concentração',
      } = p

      // Kinetics: Arrhenius k(T)
      const k = K_REF * Math.exp(-EA_R * (1 / temperature - 1 / T_REF))

      if (runRef.current) {
        // Advance impeller angle
        impAngleRef.current += agitatorSpeed * dt * 0.003

        // Physics
        stepPhysics(dt, agitatorSpeed)

        // Chemical conversion (batch, first-order irreversible)
        simTime += (dt / 1000) * SIM_SPD
        Ca = Math.max(0, Ca0 * Math.exp(-k * simTime))
      }

      const X         = 1 - Ca / Ca0
      const CB        = Ca0 - Ca
      const mixedness = Math.min(1, simTime * 0.03 * agitatorSpeed)

      // ── Render ──────────────────────────────────────────────────────
      // Full-canvas background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, '#dbeafe')
      bg.addColorStop(1, '#f0f4f8')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // Jacket colour (temperature-driven: cold=blue, warm=orange-red)
      const tNorm      = Math.max(0, Math.min(1, (temperature - 320) / 100))
      const jR         = Math.round(0   + 238 * tNorm)
      const jG         = Math.round(119 -  38 * tNorm)
      const jB         = Math.round(187 - 136 * tNorm)
      const jacketColor = `rgba(${jR},${jG},${jB},0.60)`

      // Clip to vessel interior → draw temperature tint + particles
      ctx.save()
      rrPath(ctx, VX, VY, VW, VH, VR)
      ctx.clip()

      // Vessel background tint (subtle temperature colour wash)
      const bgR = Math.round(219 * tNorm)
      const bgG = Math.round(234 - 190 * tNorm)
      const bgB = Math.round(254 - 210 * tNorm)
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},0.18)`
      ctx.fillRect(VX, VY, VW, VH)

      drawParticles(colorMode, Ca0, mixedness)
      ctx.restore()

      // Draw vessel frame + impeller ON TOP of particles (outside clip)
      drawVessel(ctx, impAngleRef.current, jacketColor)
      drawStats(ctx, X, Ca, CB, simTime, k, temperature)

      // Mixing quality badge
      ctx.save()
      ctx.font      = 'bold 10px sans-serif'
      ctx.fillStyle = `hsl(${mixedness * 120}, 65%, 42%)`
      ctx.textAlign = 'right'
      ctx.fillText(`Mistura: ${(mixedness * 100).toFixed(0)}%`, W - 50, H - 8)
      ctx.restore()

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)

    return () => {
      if (animId) cancelAnimationFrame(animId)
    }
  }, [])   // [] — key-driven remount (key={resetKey} from parent) handles full reset

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label="Simulação 2D do reator batelada com canvas nativo e hash espacial"
      style={{
        display     : 'block',
        margin      : '0 auto',
        borderRadius: 12,
        boxShadow   : '0 4px 24px rgba(0,0,0,0.14)',
      }}
    />
  )
}
