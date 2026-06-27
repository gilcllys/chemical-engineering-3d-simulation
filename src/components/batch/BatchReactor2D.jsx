/**
 * BatchReactor2D.jsx
 * ──────────────────
 * Pure-JS Canvas 2D simulation of a batch reactor.
 * Reaction: A → B  (first-order)
 *   Ca(t) = Ca0 · exp(−k · t)   k = 0.08 s⁻¹ (default)
 *   X     = 1 − exp(−k · t)
 *
 * Visual structure:
 *   · Rounded-rect vessel outline
 *   · Orange/yellow jacket bands on the outside
 *   · Central agitator shaft + 3-blade rotating impeller
 *   · Inlet pipe (top-left), outlet pipe (bottom-right)
 *   · 120 coloured particles (blue→red with conversion X)
 *   · Conversion bar + live CA / t readout at the bottom
 *
 * Props:
 *   isRunning  {boolean}  – pause / resume physics + impeller
 *
 * Pattern: same as CycloneSimulator2D.jsx
 *   useRef + requestAnimationFrame inside useEffect
 *   Resets fully when React remounts (key prop on parent)
 */

import { useRef, useEffect } from 'react'

// ── Canvas dimensions ─────────────────────────────────────────────────
const W = 480
const H = 620

// ── Vessel geometry (px) ──────────────────────────────────────────────
const VX  = 90     // left edge
const VY  = 58     // top edge
const VW  = 300    // width
const VH  = 420    // height
const VR  = 54     // corner radius
const CX  = VX + VW / 2   // 240  – horizontal centre
const CY  = VY + VH / 2   // 268  – vertical centre

// Particle containment bounds (vessel interior minus margin)
const MARGIN = 18
const PX1    = VX + MARGIN
const PX2    = VX + VW - MARGIN
const PY1    = VY + MARGIN
const PY2    = VY + VH - MARGIN

// ── Physics constants ─────────────────────────────────────────────────
const K_RATE      = 0.08   // first-order rate constant (1/s)
const CA0         = 1.0    // initial concentration     (mol/L)
const N_PARTICLES = 120    // number of molecules shown

// Impeller geometry (px)
const IMP_Y      = CY + 130   // impeller centre y
const BLADE_LEN  = 60         // half-blade length

// ── Colour helper: Paul Tol  #0077BB → #CC3311 ────────────────────────
// #0077BB = rgb(0,   119, 187)
// #CC3311 = rgb(204,  51,  17)
function reactionColor(x) {
  const t = Math.max(0, Math.min(1, x))
  const r = Math.round(  0 + 204 * t)
  const g = Math.round(119 -  68 * t)
  const b = Math.round(187 - 170 * t)
  return `rgb(${r},${g},${b})`
}

// ── Rounded-rectangle path helper ─────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y,         x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h,     x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x,     y + h,     x, y + h - r)
  ctx.lineTo(x,     y + r)
  ctx.quadraticCurveTo(x,     y,         x + r, y)
  ctx.closePath()
}

// ── Particle factory ──────────────────────────────────────────────────
function makeParticle() {
  const orbitR = 18 + Math.random() * 100
  const angle  = Math.random() * Math.PI * 2
  return {
    x          : CX + Math.cos(angle) * orbitR,
    y          : CY + Math.sin(angle) * orbitR * 1.15,
    vx         : 0,
    vy         : 0,
    radius     : 2.4 + Math.random() * 2.8,
    orbitAngle : angle,
    orbitR,
    orbitSpd   : (0.35 + Math.random() * 0.90) * (Math.random() < 0.5 ? 1 : -1),
    noise      : (Math.random() - 0.5) * 0.28,
  }
}

// ── Draw static + animated vessel structure ───────────────────────────
function drawVessel(ctx, impAngle) {

  // ── Jacket bands – orange horizontal stripes outside vessel ──────────
  for (let y = VY + 16; y < VY + VH - 16; y += 28) {
    // left side
    ctx.fillStyle = 'rgba(238,119,51,0.60)'
    ctx.fillRect(VX - 14, y, 13, 16)
    // right side
    ctx.fillRect(VX + VW + 1, y, 13, 16)
  }

  // ── Jacket dashed outline ─────────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = 'rgba(238,119,51,0.42)'
  ctx.lineWidth   = 1.5
  ctx.setLineDash([5, 4])
  roundRectPath(ctx, VX - 14, VY + 10, VW + 28, VH - 20, VR + 6)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // ── Jacket label ─────────────────────────────────────────────────────
  ctx.save()
  ctx.fillStyle  = '#b45309'
  ctx.font       = 'bold 9px sans-serif'
  ctx.textAlign  = 'center'
  ctx.fillText('Jaqueta Térmica', VX - 8, VY + 6)
  ctx.restore()

  // ── Vessel body fill ─────────────────────────────────────────────────
  ctx.save()
  roundRectPath(ctx, VX, VY, VW, VH, VR)
  ctx.fillStyle = 'rgba(58,140,200,0.07)'
  ctx.fill()
  ctx.restore()

  // ── Vessel outline ────────────────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth   = 4
  roundRectPath(ctx, VX, VY, VW, VH, VR)
  ctx.stroke()
  ctx.restore()

  // ── Inlet pipe – top-left ─────────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth   = 9
  ctx.lineCap     = 'round'
  ctx.beginPath()
  ctx.moveTo(VX - 46, VY + 80)
  ctx.lineTo(VX + 2,  VY + 80)
  ctx.stroke()
  // flange at end
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(VX - 46, VY + 72)
  ctx.lineTo(VX - 46, VY + 88)
  ctx.stroke()
  // label
  ctx.fillStyle  = '#1e293b'
  ctx.font       = 'bold 10px sans-serif'
  ctx.textAlign  = 'center'
  ctx.fillText('← Entrada A', VX - 46, VY + 68)
  ctx.restore()

  // ── Outlet pipe – bottom-right ────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = '#2a5c8e'
  ctx.lineWidth   = 9
  ctx.lineCap     = 'round'
  ctx.beginPath()
  ctx.moveTo(VX + VW - 2, VY + VH - 80)
  ctx.lineTo(VX + VW + 46, VY + VH - 80)
  ctx.stroke()
  // flange
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(VX + VW + 46, VY + VH - 88)
  ctx.lineTo(VX + VW + 46, VY + VH - 72)
  ctx.stroke()
  // label
  ctx.fillStyle  = '#1e293b'
  ctx.font       = 'bold 10px sans-serif'
  ctx.textAlign  = 'center'
  ctx.fillText('Saída B →', VX + VW + 46, VY + VH - 68)
  ctx.restore()

  // ── Agitator shaft ────────────────────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = '#475569'
  ctx.lineWidth   = 4
  ctx.beginPath()
  ctx.moveTo(CX, VY - 14)     // exits through top dome
  ctx.lineTo(CX, IMP_Y)        // down to impeller depth (~70 % vessel)
  ctx.stroke()
  ctx.restore()

  // ── Motor block on top of shaft ───────────────────────────────────────
  ctx.save()
  ctx.fillStyle   = '#64748b'
  ctx.strokeStyle = '#475569'
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.roundRect
    ? ctx.roundRect(CX - 14, VY - 36, 28, 22, 4)
    : roundRectPath(ctx, CX - 14, VY - 36, 28, 22, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f1f5f9'
  ctx.font      = 'bold 8px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('M', CX, VY - 21)
  ctx.restore()

  // ── Impeller hub ──────────────────────────────────────────────────────
  ctx.save()
  ctx.beginPath()
  ctx.arc(CX, IMP_Y, 8, 0, Math.PI * 2)
  ctx.fillStyle = '#334155'
  ctx.fill()
  ctx.restore()

  // ── Impeller blades (3, rotating) ────────────────────────────────────
  ctx.save()
  ctx.strokeStyle = '#334155'
  ctx.lineWidth   = 6
  ctx.lineCap     = 'square'
  for (let i = 0; i < 3; i++) {
    const a  = impAngle + (i * Math.PI * 2) / 3
    const ca = Math.cos(a), sa = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(CX - ca * BLADE_LEN, IMP_Y - sa * BLADE_LEN * 0.50)
    ctx.lineTo(CX + ca * BLADE_LEN, IMP_Y + sa * BLADE_LEN * 0.50)
    ctx.stroke()
  }
  ctx.restore()

  // ── Vessel title ──────────────────────────────────────────────────────
  ctx.save()
  ctx.fillStyle = '#1e293b'
  ctx.font      = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('⚗️  Reator Batelada', CX, VY - 42)
  ctx.restore()
}

// ── Draw conversion bar + kinetic readout ─────────────────────────────
function drawStats(ctx, X, Ca, t) {
  const bx = 42
  const by = VY + VH + 20
  const bw = W - 84
  const bh = 16

  // Bar track
  ctx.save()
  ctx.fillStyle = '#e2e8f0'
  roundRectPath(ctx, bx, by, bw, bh, 8)
  ctx.fill()

  // Bar fill – blue → red gradient
  if (X > 0.001) {
    const fill = bw * X
    const barG = ctx.createLinearGradient(bx, 0, bx + fill, 0)
    barG.addColorStop(0, '#0077BB')
    barG.addColorStop(1, '#CC3311')
    ctx.fillStyle = barG
    roundRectPath(ctx, bx, by, fill, bh, 8)
    ctx.fill()
  }
  ctx.restore()

  // Labels above bar
  ctx.save()
  ctx.font      = 'bold 11px sans-serif'
  ctx.fillStyle = '#0077BB'
  ctx.textAlign = 'left'
  ctx.fillText('A → B', bx, by - 4)
  ctx.fillStyle = '#334155'
  ctx.textAlign = 'right'
  ctx.fillText(`Conversão: ${(X * 100).toFixed(1)} %`, bx + bw, by - 4)
  ctx.restore()

  // Numeric row below bar
  ctx.save()
  ctx.font = '11px monospace'

  ctx.fillStyle = '#0077BB'
  ctx.textAlign = 'left'
  ctx.fillText(`CA = ${Ca.toFixed(4)} mol/L`, bx, by + bh + 15)

  ctx.fillStyle = '#64748b'
  ctx.textAlign = 'center'
  ctx.fillText(`t = ${t.toFixed(1)} s`, bx + bw / 2, by + bh + 15)

  ctx.fillStyle = '#CC3311'
  ctx.textAlign = 'right'
  ctx.fillText(`CB = ${(CA0 - Ca).toFixed(4)} mol/L`, bx + bw, by + bh + 15)
  ctx.restore()

  // Particle count
  ctx.save()
  ctx.fillStyle = 'rgba(30,41,59,0.55)'
  ctx.font      = '10px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`Partículas: ${N_PARTICLES}`, bx, H - 8)
  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────
export default function BatchReactor2D({ isRunning = true }) {
  const canvasRef   = useRef(null)
  const partsRef    = useRef([])
  const timeRef     = useRef(0)
  const lastRef     = useRef(null)
  const impRef      = useRef(0)    // impeller angle (radians)
  const animRef     = useRef(null)
  const runRef      = useRef(isRunning)

  // Keep ref in sync with prop (safe for animation-loop closure)
  useEffect(() => { runRef.current = isRunning }, [isRunning])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // ── Initialise simulation state ──────────────────────────────────
    partsRef.current = Array.from({ length: N_PARTICLES }, makeParticle)
    timeRef.current  = 0
    lastRef.current  = null
    impRef.current   = 0

    // ── Main animation loop ───────────────────────────────────────────
    function loop(ts) {
      const last = lastRef.current
      const dt   = last !== null ? Math.min((ts - last) / 1000, 0.05) : 1 / 60
      lastRef.current = ts

      const running = runRef.current

      // ── Advance time & impeller ───────────────────────────────────
      if (running) {
        timeRef.current += dt
        impRef.current  += dt * 2.4   // impeller angular speed (rad/s)
      }

      const t  = timeRef.current
      const X  = 1 - Math.exp(-K_RATE * t)
      const Ca = CA0 * (1 - X)

      // ── Physics step ──────────────────────────────────────────────
      if (running) {
        for (const p of partsRef.current) {
          // Circular orbital mixing (driven by agitator)
          p.orbitAngle += dt * p.orbitSpd
          const tx = CX + Math.cos(p.orbitAngle) * p.orbitR
          const ty = CY + Math.sin(p.orbitAngle) * p.orbitR * 1.1

          // Spring towards orbit position
          p.vx += (tx - p.x) * 2.8 * dt
          p.vy += (ty - p.y) * 2.8 * dt

          // Brownian perturbation
          p.vx += (Math.random() - 0.5) * 90 * dt
          p.vy += (Math.random() - 0.5) * 90 * dt

          // Velocity damping
          const damp = 1 - 5.5 * dt
          p.vx *= damp
          p.vy *= damp

          // Integrate position
          p.x += p.vx * dt
          p.y += p.vy * dt

          // Clamp to vessel interior (rectangular approximation)
          const pr = p.radius
          p.x = Math.max(PX1 + pr, Math.min(PX2 - pr, p.x))
          p.y = Math.max(PY1 + pr, Math.min(PY2 - pr, p.y))
        }
      }

      // ── Render ────────────────────────────────────────────────────

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, '#dbeafe')
      bg.addColorStop(1, '#f0f4f8')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // Vessel + agitator
      drawVessel(ctx, impRef.current)

      // Particles
      for (const p of partsRef.current) {
        const lx = Math.max(0, Math.min(1, X + p.noise))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle   = reactionColor(lx)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'
        ctx.lineWidth   = 0.6
        ctx.stroke()
      }

      // Stats panel
      drawStats(ctx, X, Ca, t)

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animRef.current)
    }
  }, []) // [] → runs once per mount; key on parent triggers remount for reset

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label="Simulação 2D de reator batelada — reação de primeira ordem A para B"
      style={{
        display     : 'block',
        margin      : '0 auto',
        borderRadius: 12,
        boxShadow   : '0 4px 24px rgba(0,0,0,0.14)',
      }}
    />
  )
}
