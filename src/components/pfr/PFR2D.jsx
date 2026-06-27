/**
 * PFR2D.jsx
 * ─────────
 * Pure Canvas 2D simulation of a Plug Flow Reactor.
 *
 * Physics (fixed defaults):
 *   k   = 0.15 s⁻¹         (k0 at T_ref = 350 K)
 *   Ca0 = 2.0  mol/L
 *   Q   = 1.0  L/s  = 0.001 m³/s
 *   A   = 0.0016 m²  (r = 0.0226 m)
 *   u   = Q / A = 0.625 m/s
 *   L   = 5.0  m
 *   τ   = L / u = 8.0 s
 *   X   = 1 - exp(-k·τ) ≈ 0.699
 *   Ca_exit = Ca0·exp(-k·τ) ≈ 0.601 mol/L
 *
 * Layout (480 × 640 canvas):
 *   LEFT  – vertical tube cross-section
 *             · 12 horizontal bands  blue→red by z/L
 *             · 80 static catalyst dots
 *             · 70 flowing particles (plug flow, straight down)
 *             · feed arrow (top) + product arrow (bottom)
 *   RIGHT – concentration profile chart
 *             · Ca(z) = Ca0·exp(-k·z/u) plotted as a curve
 *             · z on y-axis (top = inlet), Ca on x-axis (right = Ca0)
 *
 * Props:
 *   isRunning  – boolean (controlled by PFRPage2D)
 */

import { useRef, useEffect } from 'react'

// ── Canvas dimensions ────────────────────────────────────────────────────────
const W = 480
const H = 640

// ── Physics constants (fixed) ─────────────────────────────────────────────────
const K      = 0.15          // s⁻¹
const CA0    = 2.0           // mol/L
const Q_M3   = 0.001         // m³/s
const A_M2   = 0.0016        // m²
const U      = Q_M3 / A_M2  // 0.625 m/s
const L_TUBE = 5.0           // m
const TAU    = L_TUBE / U    // 8.0 s
const X_EXIT = 1 - Math.exp(-K * TAU)
const CA_EXIT = CA0 * Math.exp(-K * TAU)

// ── Tube geometry (pixels) ───────────────────────────────────────────────────
const CX         = 112   // tube center x
const TW_INNER   = 50    // inner half-width (particle zone)
const TW_WALL    = 11    // wall thickness
const TW_OUTER   = TW_INNER + TW_WALL   // 61
const TUBE_TOP   = 88    // y – inlet (z = 0)
const TUBE_BOT   = 562   // y – outlet (z = L)
const TUBE_H     = TUBE_BOT - TUBE_TOP  // 474 px

// ── Concentration profile chart (pixels) ─────────────────────────────────────
const CH_LEFT    = 246   // x where Ca = 0
const CH_RIGHT   = 462   // x where Ca = Ca0
const CH_TOP     = TUBE_TOP
const CH_BOT     = TUBE_BOT
const CH_W       = CH_RIGHT - CH_LEFT   // 216
const CH_H       = TUBE_BOT - TUBE_TOP  // 474

// ── Colour helpers ────────────────────────────────────────────────────────────
/**
 * Hex colour lerp.
 * @param {string} c1  '#rrggbb'
 * @param {string} c2  '#rrggbb'
 * @param {number} t   0..1
 */
function lerpHex(c1, c2, t) {
  const tt = Math.max(0, Math.min(1, t))
  const r1 = parseInt(c1.slice(1, 3), 16)
  const g1 = parseInt(c1.slice(3, 5), 16)
  const b1 = parseInt(c1.slice(5, 7), 16)
  const r2 = parseInt(c2.slice(1, 3), 16)
  const g2 = parseInt(c2.slice(3, 5), 16)
  const b2 = parseInt(c2.slice(5, 7), 16)
  return `rgb(${Math.round(r1 + (r2 - r1) * tt)},${Math.round(g1 + (g2 - g1) * tt)},${Math.round(b1 + (b2 - b1) * tt)})`
}

const BLUE = '#0077BB'
const RED  = '#CC3311'

/** Band colour at relative position frac ∈ [0, 1] along tube. */
function bandColor(frac) {
  const z  = frac * L_TUBE
  const Ca = CA0 * Math.exp(-K * z / U)
  return lerpHex(BLUE, RED, 1 - Ca / CA0)
}

/** Particle colour by y-position inside tube. */
function particleColor(y) {
  const frac = (y - TUBE_TOP) / TUBE_H          // 0=top 1=bottom
  const z    = frac * L_TUBE
  const Ca   = CA0 * Math.exp(-K * z / U)
  return lerpHex(BLUE, RED, 1 - Ca / CA0)
}

// ── Pre-generated static catalyst dots (stable between renders) ───────────────
const N_CATALYST = 72
const CATALYST_DOTS = Array.from({ length: N_CATALYST }, () => ({
  x: CX + (Math.random() - 0.5) * 2 * (TW_INNER - 6),
  y: TUBE_TOP + 4 + Math.random() * (TUBE_H - 8),
  r: 2.2 + Math.random() * 1.8,
}))

// ── Particle factory ──────────────────────────────────────────────────────────
const N_PARTICLES   = 68
const PARTICLE_SPEED = 82   // px/s  (tube transited in ~5.8 s ≈ visual interest)

function makeParticle(spreadY = false) {
  return {
    x:  CX + (Math.random() - 0.5) * 2 * (TW_INNER - 6),
    y:  spreadY
          ? TUBE_TOP + Math.random() * TUBE_H   // staggered initial fill
          : TUBE_TOP - Math.random() * 20,       // just above inlet
    vy: PARTICLE_SPEED * (0.85 + Math.random() * 0.3),
  }
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

/** Background gradient. */
function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#dbeafe')
  grad.addColorStop(1, '#f0f4f8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
}

/** Tube cross-section: walls + 12 gradient bands + catalyst dots. */
function drawTube(ctx) {
  const N_BANDS = 12
  const bandH   = TUBE_H / N_BANDS

  // ── 12 horizontal gradient bands ─────────────────────────────────────────
  for (let i = 0; i < N_BANDS; i++) {
    const by   = TUBE_TOP + i * bandH
    const frac = (i + 0.5) / N_BANDS
    ctx.fillStyle = bandColor(frac)
    ctx.fillRect(CX - TW_INNER, by, TW_INNER * 2, bandH + 0.5)   // +0.5 anti-gap
  }

  // ── Left wall ─────────────────────────────────────────────────────────────
  const wallGrad = ctx.createLinearGradient(CX - TW_OUTER, 0, CX - TW_INNER, 0)
  wallGrad.addColorStop(0, '#374151')
  wallGrad.addColorStop(1, '#6b7280')
  ctx.fillStyle = wallGrad
  ctx.fillRect(CX - TW_OUTER, TUBE_TOP, TW_WALL, TUBE_H)

  // ── Right wall ────────────────────────────────────────────────────────────
  const wallGrad2 = ctx.createLinearGradient(CX + TW_INNER, 0, CX + TW_OUTER, 0)
  wallGrad2.addColorStop(0, '#6b7280')
  wallGrad2.addColorStop(1, '#374151')
  ctx.fillStyle = wallGrad2
  ctx.fillRect(CX + TW_INNER, TUBE_TOP, TW_WALL, TUBE_H)

  // ── Wall outlines ─────────────────────────────────────────────────────────
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth   = 1.5
  ctx.strokeRect(CX - TW_OUTER, TUBE_TOP, TW_OUTER * 2, TUBE_H)
  // inner border lines
  ctx.beginPath()
  ctx.moveTo(CX - TW_INNER, TUBE_TOP);  ctx.lineTo(CX - TW_INNER, TUBE_BOT)
  ctx.moveTo(CX + TW_INNER, TUBE_TOP);  ctx.lineTo(CX + TW_INNER, TUBE_BOT)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth   = 0.8
  ctx.stroke()

  // ── Catalyst dots (gray pellets) ─────────────────────────────────────────
  for (const d of CATALYST_DOTS) {
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    ctx.fillStyle   = 'rgba(156,163,175,0.60)'
    ctx.strokeStyle = 'rgba(107,114,128,0.50)'
    ctx.lineWidth   = 0.6
    ctx.fill()
    ctx.stroke()
  }

  // ── Top cap ───────────────────────────────────────────────────────────────
  ctx.fillStyle = '#374151'
  ctx.fillRect(CX - TW_OUTER, TUBE_TOP - 8, TW_OUTER * 2, 8)
  // Bottom cap
  ctx.fillRect(CX - TW_OUTER, TUBE_BOT, TW_OUTER * 2, 8)

  // ── Feed inlet nozzle (top, horizontal pipe) ──────────────────────────────
  ctx.fillStyle = '#4b5563'
  ctx.fillRect(CX + TW_OUTER, TUBE_TOP + 14, 28, 14)   // right side nozzle
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth   = 1
  ctx.strokeRect(CX + TW_OUTER, TUBE_TOP + 14, 28, 14)

  // ── Outlet nozzle (bottom, horizontal pipe) ───────────────────────────────
  ctx.fillStyle = '#4b5563'
  ctx.fillRect(CX + TW_OUTER, TUBE_BOT - 28, 28, 14)
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth   = 1
  ctx.strokeRect(CX + TW_OUTER, TUBE_BOT - 28, 28, 14)
}

/** Feed and product arrows / labels. */
function drawLabels(ctx) {
  ctx.textAlign    = 'center'
  ctx.font         = 'bold 11px sans-serif'

  // Feed arrow + label (above tube)
  ctx.fillStyle = '#0077BB'
  ctx.fillText('↓', CX, TUBE_TOP - 32)
  ctx.font      = 'bold 10px sans-serif'
  ctx.fillText(`Feed  CA₀ = ${CA0.toFixed(1)} mol/L`, CX, TUBE_TOP - 18)

  // Product arrow + label (below tube)
  ctx.fillStyle = '#CC3311'
  ctx.font      = 'bold 11px sans-serif'
  ctx.fillText('↑', CX, TUBE_BOT + 34)
  ctx.font      = 'bold 10px sans-serif'
  ctx.fillText(`Produto  CA = ${CA_EXIT.toFixed(2)} mol/L`, CX, TUBE_BOT + 22)

  // Side z-labels
  ctx.fillStyle = '#64748b'
  ctx.font      = '9px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('z = 0', CX - TW_OUTER - 4, TUBE_TOP + 5)
  ctx.fillText(`z = ${L_TUBE}m`, CX - TW_OUTER - 4, TUBE_BOT)
}

/** Concentration profile chart (right side). */
function drawChart(ctx) {
  // ── Panel background ──────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(248,250,252,0.92)'
  ctx.beginPath()
  ctx.roundRect(CH_LEFT - 30, CH_TOP - 10, CH_W + 36, CH_H + 20, 8)
  ctx.fill()

  // ── Axes ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#334155'
  ctx.lineWidth   = 1.6
  ctx.beginPath()
  ctx.moveTo(CH_LEFT, CH_TOP)
  ctx.lineTo(CH_LEFT, CH_BOT)    // y-axis (z direction)
  ctx.lineTo(CH_RIGHT, CH_BOT)   // x-axis (Ca)
  ctx.stroke()

  // ── X-axis ticks (Ca 0 → Ca0) ─────────────────────────────────────────────
  ctx.fillStyle   = '#64748b'
  ctx.font        = '9px sans-serif'
  ctx.textAlign   = 'center'
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth   = 0.8
  const N_X = 4
  for (let i = 0; i <= N_X; i++) {
    const ca = (i / N_X) * CA0
    const x  = CH_LEFT + (ca / CA0) * CH_W
    ctx.beginPath()
    ctx.moveTo(x, CH_BOT)
    ctx.lineTo(x, CH_BOT + 4)
    ctx.stroke()
    ctx.fillText(ca.toFixed(1), x, CH_BOT + 14)
    // Light grid line
    if (i > 0 && i < N_X) {
      ctx.beginPath()
      ctx.moveTo(x, CH_TOP)
      ctx.lineTo(x, CH_BOT)
      ctx.strokeStyle = 'rgba(148,163,184,0.25)'
      ctx.stroke()
      ctx.strokeStyle = '#94a3b8'
    }
  }
  ctx.fillText('CA (mol/L)', CH_LEFT + CH_W / 2, CH_BOT + 26)

  // ── Y-axis ticks (z 0 → L) ────────────────────────────────────────────────
  ctx.textAlign = 'right'
  const N_Z = 5
  for (let i = 0; i <= N_Z; i++) {
    const z = (i / N_Z) * L_TUBE
    const y = CH_TOP + (z / L_TUBE) * CH_H
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth   = 0.8
    ctx.beginPath()
    ctx.moveTo(CH_LEFT, y)
    ctx.lineTo(CH_LEFT - 4, y)
    ctx.stroke()
    ctx.fillStyle = '#64748b'
    ctx.font      = '9px sans-serif'
    ctx.fillText(`${z.toFixed(0)} m`, CH_LEFT - 7, y + 3)
    // Grid line
    if (i > 0 && i < N_Z) {
      ctx.beginPath()
      ctx.moveTo(CH_LEFT, y)
      ctx.lineTo(CH_RIGHT, y)
      ctx.strokeStyle = 'rgba(148,163,184,0.25)'
      ctx.stroke()
    }
  }

  // ── Y-axis label (rotated) ────────────────────────────────────────────────
  ctx.save()
  ctx.translate(CH_LEFT - 24, CH_TOP + CH_H / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#64748b'
  ctx.font      = '9px sans-serif'
  ctx.fillText('z  (posição axial)', 0, 0)
  ctx.restore()

  // ── Ca(z) curve ───────────────────────────────────────────────────────────
  const N_PTS = 100
  // Gradient fill area under curve
  const areaGrad = ctx.createLinearGradient(CH_RIGHT, 0, CH_LEFT, 0)
  areaGrad.addColorStop(0, 'rgba(0,119,187,0.18)')
  areaGrad.addColorStop(1, 'rgba(204,51,17,0.08)')
  ctx.beginPath()
  for (let j = 0; j <= N_PTS; j++) {
    const z  = (j / N_PTS) * L_TUBE
    const Ca = CA0 * Math.exp(-K * z / U)
    const x  = CH_LEFT + (Ca / CA0) * CH_W
    const y  = CH_TOP  + (z / L_TUBE) * CH_H
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.lineTo(CH_LEFT, CH_BOT)
  ctx.lineTo(CH_RIGHT, CH_TOP)
  ctx.closePath()
  ctx.fillStyle = areaGrad
  ctx.fill()

  // Main curve
  ctx.beginPath()
  ctx.strokeStyle = '#0077BB'
  ctx.lineWidth   = 2.5
  ctx.lineJoin    = 'round'
  for (let j = 0; j <= N_PTS; j++) {
    const z  = (j / N_PTS) * L_TUBE
    const Ca = CA0 * Math.exp(-K * z / U)
    const x  = CH_LEFT + (Ca / CA0) * CH_W
    const y  = CH_TOP  + (z / L_TUBE) * CH_H
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  // ── Annotations ────────────────────────────────────────────────────────────
  ctx.font      = 'bold 10px monospace'
  ctx.textAlign = 'left'

  // X_exit badge (bottom-left of chart)
  const badgeX = CH_LEFT + 6
  const badgeY = CH_BOT - 42
  ctx.fillStyle = 'rgba(204,51,17,0.12)'
  ctx.beginPath()
  ctx.roundRect(badgeX - 3, badgeY - 13, 100, 38, 5)
  ctx.fill()
  ctx.fillStyle = '#CC3311'
  ctx.fillText(`X = ${(X_EXIT * 100).toFixed(1)} %`, badgeX, badgeY)
  ctx.fillStyle = '#EE7733'
  ctx.fillText(`τ = ${TAU.toFixed(0)} s`, badgeX, badgeY + 14)
  ctx.fillStyle = '#009988'
  ctx.fillText(`k = ${K} s⁻¹`, badgeX, badgeY + 28)

  // Chart title
  ctx.font      = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#1e293b'
  ctx.fillText('Perfil de Concentração', CH_LEFT + CH_W / 2, CH_TOP - 3)

  // Arrow showing direction of flow
  ctx.fillStyle   = '#0077BB'
  ctx.font        = '11px sans-serif'
  ctx.textAlign   = 'right'
  ctx.fillText('← entrada  CA₀', CH_RIGHT - 2, CH_TOP + 12)
  ctx.fillStyle   = '#CC3311'
  ctx.textAlign   = 'left'
  ctx.fillText('CA_saída →', CH_LEFT + 2, CH_BOT - 5)
}

/** Status bar. */
function drawStats(ctx, nParticles) {
  ctx.fillStyle = 'rgba(30,41,59,0.62)'
  ctx.font      = '10px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(
    `Partículas: ${nParticles} | X_saída=${(X_EXIT * 100).toFixed(1)}% | τ=${TAU.toFixed(0)}s | k=${K}s⁻¹`,
    8, H - 8,
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PFR2D({ isRunning = true }) {
  const canvasRef    = useRef(null)
  const poolRef      = useRef([])
  const lastTimeRef  = useRef(null)
  const animFrameRef = useRef(null)
  const isRunningRef = useRef(isRunning)

  // Keep isRunning in sync without restarting the loop
  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // Initialise particle pool staggered across the tube height
    poolRef.current = Array.from({ length: N_PARTICLES }, () => makeParticle(true))

    // Spawner: gradually add new particles until pool is full
    let spawnTimer = 0

    function loop(timestamp) {
      const last = lastTimeRef.current
      const dt   = last ? Math.min((timestamp - last) / 1000, 1 / 30) : 1 / 60
      lastTimeRef.current = timestamp

      if (isRunningRef.current) {
        // ── Physics ────────────────────────────────────────────────────────
        spawnTimer += dt
        // Spawn replacement particle every 200ms when pool shrinks
        if (spawnTimer > 0.2 && poolRef.current.length < N_PARTICLES) {
          poolRef.current.push(makeParticle(false))
          spawnTimer = 0
        }

        for (const p of poolRef.current) {
          p.y += p.vy * dt  // plug flow: straight down, no lateral forces
        }
        // Remove particles that have exited the bottom, immediately replace
        poolRef.current = poolRef.current.filter(p => {
          if (p.y > TUBE_BOT + 8) {
            poolRef.current.push(makeParticle(false))
            return false
          }
          return true
        })
      }

      // ── Render ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H)
      drawBackground(ctx)
      drawChart(ctx)
      drawTube(ctx)
      drawLabels(ctx)

      // Particles (drawn after tube so they appear inside)
      for (const p of poolRef.current) {
        if (p.y < TUBE_TOP || p.y > TUBE_BOT) continue   // clip to tube
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2)
        ctx.fillStyle   = particleColor(p.y)
        ctx.shadowColor = 'rgba(0,0,0,0.18)'
        ctx.shadowBlur  = 2
        ctx.fill()
        ctx.shadowBlur  = 0
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'
        ctx.lineWidth   = 0.5
        ctx.stroke()
      }

      drawStats(ctx, poolRef.current.length)

      animFrameRef.current = requestAnimationFrame(loop)
    }

    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label="Simulação 2D do Reator PFR — perfil axial de concentração"
      style={{
        display:     'block',
        margin:      '0 auto',
        borderRadius: 14,
        boxShadow:   '0 4px 28px rgba(0,0,0,0.16)',
      }}
    />
  )
}
