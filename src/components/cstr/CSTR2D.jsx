/**
 * CSTR2D.jsx
 * ──────────
 * Pure Canvas-2D simulation of a Continuous Stirred Tank Reactor.
 * No external physics library – hand-rolled particle loop.
 *
 * Physics (steady-state target):
 *   k(T)  = k₀ · exp(−Eₐ/R · (1/T − 1/T₀))    k₀=0.12 s⁻¹, Eₐ/R=5000 K, T₀=350 K
 *   τ     = V / Q                                 V=10 L, Q=1 L/s  →  τ=10 s
 *   X_ss  = kτ / (1+kτ)                           ≈ 0.545
 *   Cₐ    = Cₐ₀·(1−X)
 *
 * Transient: X → X_ss with time constant τ_trans ≈ 4 s.
 * Interior colour = lerp(#0077BB, #CC3311, X)  — well-mixed assumption.
 *
 * Props:  isRunning {boolean}
 */

import { useRef, useEffect } from 'react'

// ── Canvas dimensions ────────────────────────────────────────────────────────
const W = 480
const H = 640

// ── Kinetic defaults ─────────────────────────────────────────────────────────
const K0      = 0.12    // s⁻¹
const EA_R    = 5000    // K
const T_REF   = 350     // K
const T_DEF   = 350     // K  (default operating temperature)
const V_DEF   = 10      // L
const Q_DEF   = 1.0     // L/s
const CA0_DEF = 2.0     // mol/L

// ── Vessel geometry (pixels) ─────────────────────────────────────────────────
const VX_L  = 90     // vessel left wall  x
const VX_R  = 390    // vessel right wall x
const VY_T  = 128    // vessel top y
const VY_B  = 492    // vessel bottom y
const VCX   = (VX_L + VX_R) / 2   // 240  – vessel centre x
const VCY   = (VY_T + VY_B) / 2   // 310  – vessel centre y
const VW    = VX_R - VX_L          // 300  – vessel width
const VH    = VY_B - VY_T          // 364  – vessel height
const VRAD  = 12                   // corner radius for vessel

// Jacket (outer rectangle)
const JX_L  = VX_L - 14
const JX_R  = VX_R + 14
const JY_T  = VY_T + 6
const JY_B  = VY_B - 6

// Motor
const MTR_W  = 60, MTR_H = 38
const MTR_X  = VCX - MTR_W / 2
const MTR_Y  = VY_T - MTR_H - 6

// Impeller y and blade half-length
const IMP_Y  = VY_T + VH * 0.72   // ≈ 390
const BLADE  = 68                   // half-blade length

// Feed / outlet
const FEED_Y = VY_T + 50
const OUT_Y  = VY_B - 40

// Stats bar area
const BAR_Y  = VY_B + 32

// ── Paul Tol palette ─────────────────────────────────────────────────────────
const HEX_A = '#0077BB'   // reagent A – blue
const HEX_B = '#CC3311'   // product B – red

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}
const RGB_A = hexToRgb(HEX_A)
const RGB_B = hexToRgb(HEX_B)

function lerpRgb(t) {
  const r = Math.round(RGB_A.r + (RGB_B.r - RGB_A.r) * t)
  const g = Math.round(RGB_A.g + (RGB_B.g - RGB_A.g) * t)
  const b = Math.round(RGB_A.b + (RGB_B.b - RGB_A.b) * t)
  return `rgb(${r},${g},${b})`
}

// ── Particle factory ─────────────────────────────────────────────────────────
function makeParticles(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      x : VX_L + 12 + Math.random() * (VW - 24),
      y : VY_T + 12 + Math.random() * (VH - 24),
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 0.5) * 18,
      r : 3 + Math.random() * 2,
    })
  }
  return out
}

// ── Rounded rect helper ───────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
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

// ── Arrowhead helper ─────────────────────────────────────────────────────────
function arrowHead(ctx, x, y, angle, size = 8) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size, -size * 0.5)
  ctx.lineTo(-size,  size * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ── Draw static structure ─────────────────────────────────────────────────────
function drawStructure(ctx, X, k, tau, Ca, angle) {
  const col     = lerpRgb(X)
  const colA70  = lerpRgb(X).replace('rgb', 'rgba').replace(')', ',0.22)')

  // ── Background gradient ─────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H)
  bgGrad.addColorStop(0, '#dbeafe')
  bgGrad.addColorStop(1, '#f0f4f8')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  // ── Cooling jacket ──────────────────────────────────────────────────────
  // Background bands (horizontal stripes on left and right)
  const bandCount = 6
  const bandH = (JY_B - JY_T) / bandCount
  for (let i = 0; i < bandCount; i++) {
    const by = JY_T + i * bandH
    // Left jacket strip
    ctx.fillStyle = i % 2 === 0 ? 'rgba(238,119,51,0.32)' : 'rgba(238,119,51,0.18)'
    ctx.fillRect(JX_L, by, VX_L - JX_L, bandH)
    // Right jacket strip
    ctx.fillStyle = i % 2 === 0 ? 'rgba(238,119,51,0.32)' : 'rgba(238,119,51,0.18)'
    ctx.fillRect(VX_R, by, JX_R - VX_R, bandH)
  }

  // Jacket border lines (left and right outer edges)
  ctx.strokeStyle = '#EE7733'
  ctx.lineWidth   = 2.5
  ctx.beginPath()
  ctx.rect(JX_L, JY_T, VX_L - JX_L, JY_B - JY_T)
  ctx.stroke()
  ctx.beginPath()
  ctx.rect(VX_R, JY_T, JX_R - VX_R, JY_B - JY_T)
  ctx.stroke()

  // Jacket horizontal separator lines
  ctx.strokeStyle = '#CC5500'
  ctx.lineWidth   = 1.2
  for (let i = 1; i < bandCount; i++) {
    const by = JY_T + i * bandH
    ctx.beginPath()
    ctx.moveTo(JX_L, by); ctx.lineTo(VX_L, by)
    ctx.moveTo(VX_R, by); ctx.lineTo(JX_R, by)
    ctx.stroke()
  }

  // ── Liquid fill (inside vessel) ─────────────────────────────────────────
  ctx.save()
  roundRect(ctx, VX_L + 3, VY_T + 3, VW - 6, VH - 6, VRAD - 2)
  ctx.clip()
  ctx.fillStyle = colA70
  ctx.fillRect(VX_L + 3, VY_T + 3, VW - 6, VH * 0.92)
  ctx.restore()

  // ── Vessel body (main rectangle with rounded corners) ─────────────────
  roundRect(ctx, VX_L, VY_T, VW, VH, VRAD)
  ctx.fillStyle   = 'rgba(200,230,245,0.10)'
  ctx.fill()
  ctx.strokeStyle = '#2a5c6e'
  ctx.lineWidth   = 5
  ctx.stroke()

  // ── Baffles (4 thin plates on inner walls) ─────────────────────────────
  ctx.fillStyle   = '#9eb8c8'
  ctx.strokeStyle = '#6a8fa0'
  ctx.lineWidth   = 1
  const baffH = VH * 0.28
  const baffW = 10
  const baffYs = [VY_T + VH * 0.22, VY_T + VH * 0.58]
  for (const by of baffYs) {
    // Left baffle
    ctx.beginPath(); ctx.rect(VX_L + 2, by, baffW, baffH); ctx.fill(); ctx.stroke()
    // Right baffle
    ctx.beginPath(); ctx.rect(VX_R - 2 - baffW, by, baffW, baffH); ctx.fill(); ctx.stroke()
  }

  // ── Agitator shaft ──────────────────────────────────────────────────────
  ctx.strokeStyle = '#8a9db5'
  ctx.lineWidth   = 3.5
  ctx.lineCap     = 'round'
  ctx.beginPath()
  ctx.moveTo(VCX, VY_T - 6)
  ctx.lineTo(VCX, VY_B - 14)
  ctx.stroke()

  // ── Rotating impeller (2 lines → 4 blades) ─────────────────────────────
  ctx.strokeStyle = '#5a7fa0'
  ctx.lineWidth   = 5
  ctx.lineCap     = 'round'
  ctx.beginPath()
  // Blade pair 1
  ctx.moveTo(VCX + Math.cos(angle) * BLADE, IMP_Y + Math.sin(angle) * BLADE)
  ctx.lineTo(VCX - Math.cos(angle) * BLADE, IMP_Y - Math.sin(angle) * BLADE)
  // Blade pair 2
  const a2 = angle + Math.PI / 2
  ctx.moveTo(VCX + Math.cos(a2) * BLADE, IMP_Y + Math.sin(a2) * BLADE)
  ctx.lineTo(VCX - Math.cos(a2) * BLADE, IMP_Y - Math.sin(a2) * BLADE)
  ctx.stroke()
  // Hub
  ctx.fillStyle = '#667788'
  ctx.beginPath()
  ctx.arc(VCX, IMP_Y, 7, 0, Math.PI * 2)
  ctx.fill()

  // ── Motor on top ────────────────────────────────────────────────────────
  // Motor body box
  ctx.fillStyle   = '#4a5568'
  ctx.strokeStyle = '#2d3748'
  ctx.lineWidth   = 2
  roundRect(ctx, MTR_X, MTR_Y, MTR_W, MTR_H, 6)
  ctx.fill()
  ctx.stroke()
  // Motor circle (housing)
  ctx.fillStyle = '#2d3748'
  ctx.beginPath()
  ctx.arc(VCX, MTR_Y - 14, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#4a5568'
  ctx.lineWidth   = 2
  ctx.stroke()
  // Label
  ctx.fillStyle = '#e2e8f0'
  ctx.font      = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('M', VCX, MTR_Y + MTR_H / 2 + 4)

  // ── Feed inlet (top-right side) ─────────────────────────────────────────
  // Pipe
  ctx.strokeStyle = '#33BBEE'
  ctx.lineWidth   = 10
  ctx.lineCap     = 'butt'
  ctx.beginPath()
  ctx.moveTo(VX_R + 52, FEED_Y)
  ctx.lineTo(VX_R, FEED_Y)
  ctx.stroke()
  // Flange
  ctx.strokeStyle = '#2a9fc0'
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(VX_R + 50, FEED_Y - 9)
  ctx.lineTo(VX_R + 50, FEED_Y + 9)
  ctx.stroke()
  // Arrowhead (pointing left = into vessel)
  ctx.fillStyle = '#33BBEE'
  arrowHead(ctx, VX_R + 2, FEED_Y, Math.PI, 9)
  // Label
  ctx.fillStyle = '#0077BB'
  ctx.font      = 'bold 11px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`Feed → CA₀ = ${CA0_DEF.toFixed(1)} mol/L`, VX_R + 58, FEED_Y - 8)
  ctx.font      = '10px sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.fillText(`τ = ${tau.toFixed(1)} s  |  k = ${k.toFixed(3)} s⁻¹`, VX_R + 58, FEED_Y + 7)

  // ── Product outlet (bottom-left side) ──────────────────────────────────
  ctx.strokeStyle = '#CC3311'
  ctx.lineWidth   = 10
  ctx.lineCap     = 'butt'
  ctx.beginPath()
  ctx.moveTo(VX_L - 52, OUT_Y)
  ctx.lineTo(VX_L,      OUT_Y)
  ctx.stroke()
  // Flange
  ctx.strokeStyle = '#a02808'
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(VX_L - 50, OUT_Y - 9)
  ctx.lineTo(VX_L - 50, OUT_Y + 9)
  ctx.stroke()
  // Arrowhead (pointing left = away from vessel)
  ctx.fillStyle = '#CC3311'
  arrowHead(ctx, VX_L - 54, OUT_Y, Math.PI, 9)
  // Label
  ctx.fillStyle = '#CC3311'
  ctx.font      = 'bold 11px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`← Produto   CA = ${Ca.toFixed(3)} mol/L`, VX_L - 58, OUT_Y - 8)
  ctx.font      = '10px sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.fillText(`X = ${(X * 100).toFixed(1)} %`, VX_L - 58, OUT_Y + 7)

  // ── Jacket label ────────────────────────────────────────────────────────
  ctx.save()
  ctx.translate(JX_L - 4, VCY)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = '#CC5500'
  ctx.font      = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Jaqueta de Resfriamento', 0, 0)
  ctx.restore()
}

// ── Stats bar (bottom of canvas) ─────────────────────────────────────────────
function drawStats(ctx, X, Ca, k, tau) {
  const barX = VX_L
  const barW = VW
  const barH = 14
  const barY = BAR_Y

  // Background
  ctx.fillStyle   = 'rgba(255,255,255,0.80)'
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth   = 1
  roundRect(ctx, barX - 4, barY - 20, barW + 8, barH + 36, 8)
  ctx.fill()
  ctx.stroke()

  // Label
  ctx.fillStyle = '#475569'
  ctx.font      = 'bold 10px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Conversão X', barX, barY - 6)
  ctx.fillStyle = '#94a3b8'
  ctx.font      = '9px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`Cₐ = ${Ca.toFixed(3)} mol/L  |  k = ${k.toFixed(4)} s⁻¹  |  τ = ${tau.toFixed(1)} s`, barX + barW, barY - 6)

  // Track
  ctx.fillStyle   = '#e2e8f0'
  ctx.strokeStyle = '#cbd5e1'
  roundRect(ctx, barX, barY, barW, barH, barH / 2)
  ctx.fill()
  ctx.stroke()

  // Filled portion (gradient blue → red)
  if (X > 0.002) {
    const fillW = barW * X
    const grad  = ctx.createLinearGradient(barX, 0, barX + barW, 0)
    grad.addColorStop(0,   HEX_A)
    grad.addColorStop(1,   HEX_B)
    ctx.fillStyle = grad
    ctx.save()
    roundRect(ctx, barX, barY, fillW, barH, barH / 2)
    ctx.clip()
    ctx.fillRect(barX, barY, fillW, barH)
    ctx.restore()
  }

  // X% label
  ctx.fillStyle = '#1e293b'
  ctx.font      = 'bold 11px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`${(X * 100).toFixed(1)} %`, barX + barW * X + 6, barY + barH * 0.75)

  // Tick marks (20 % intervals)
  for (let t = 0; t <= 1; t += 0.2) {
    const tx = barX + barW * t
    ctx.strokeStyle = 'rgba(100,116,139,0.5)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(tx, barY + barH)
    ctx.lineTo(tx, barY + barH + 4)
    ctx.stroke()
    ctx.fillStyle = '#94a3b8'
    ctx.font      = '8px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${Math.round(t * 100)}%`, tx, barY + barH + 13)
  }
}

// ── Component ────────────────────────────────────────────────────────────────
const N_PARTICLES = 88

export default function CSTR2D({ isRunning = true }) {
  const canvasRef     = useRef(null)
  const particlesRef  = useRef([])
  const xRef          = useRef(0)       // current transient conversion
  const angleRef      = useRef(0)       // impeller rotation angle
  const lastTimeRef   = useRef(null)
  const animRef       = useRef(null)
  const isRunningRef  = useRef(isRunning)

  // Keep isRunningRef in sync without re-mounting the loop
  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // Init particles
    particlesRef.current = makeParticles(N_PARTICLES)
    xRef.current   = 0
    angleRef.current = 0
    lastTimeRef.current = null

    // Steady-state targets (default params)
    const k0    = K0 * Math.exp(-EA_R * (1 / T_DEF - 1 / T_REF))
    const tau0  = V_DEF / Q_DEF
    const X_ss0 = (k0 * tau0) / (1 + k0 * tau0)

    function loop(timestamp) {
      const last = lastTimeRef.current
      const dt   = last ? Math.min((timestamp - last) / 1000, 1 / 30) : 1 / 60
      lastTimeRef.current = timestamp

      const running = isRunningRef.current

      // ── Physics ──────────────────────────────────────────────────────────
      if (running) {
        // Transient X approach (time constant ≈ 4 s)
        xRef.current += (X_ss0 - xRef.current) * (1 - Math.exp(-dt / 4))
        xRef.current  = Math.max(0, Math.min(1, xRef.current))

        // Impeller rotation (2 rad/s nominal)
        angleRef.current += 2.2 * dt
      }

      const X   = xRef.current
      const Ca  = CA0_DEF * (1 - X)
      const col = lerpRgb(X)

      // ── Particle physics ─────────────────────────────────────────────────
      if (running) {
        const ps = particlesRef.current
        for (let i = 0; i < ps.length; i++) {
          const p  = ps[i]
          const dx = p.x - VCX
          const dy = p.y - VCY
          const r  = Math.sqrt(dx * dx + dy * dy) + 0.1

          // Vortex: tangential impulse
          p.vx += (-dy / r) * 55 * dt
          p.vy += ( dx / r) * 55 * dt

          // Brownian
          p.vx += (Math.random() - 0.5) * 22 * dt
          p.vy += (Math.random() - 0.5) * 22 * dt

          // Damping
          p.vx *= 1 - 3.8 * dt
          p.vy *= 1 - 3.8 * dt

          // Integrate
          p.x += p.vx * dt
          p.y += p.vy * dt

          // Boundary clamp (inside vessel)
          const margin = p.r + 2
          if (p.x < VX_L + margin) { p.x = VX_L + margin; p.vx = Math.abs(p.vx) * 0.4 }
          if (p.x > VX_R - margin) { p.x = VX_R - margin; p.vx = -Math.abs(p.vx) * 0.4 }
          if (p.y < VY_T + margin) { p.y = VY_T + margin; p.vy = Math.abs(p.vy) * 0.4 }
          if (p.y > VY_B - margin) { p.y = VY_B - margin; p.vy = -Math.abs(p.vy) * 0.4 }
        }
      }

      // ── Render ────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H)
      drawStructure(ctx, X, k0, tau0, Ca, angleRef.current)

      // Particles
      const ps = particlesRef.current
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle   = col
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'
        ctx.lineWidth   = 0.6
        ctx.stroke()
      }

      // Stats bar
      drawStats(ctx, X, Ca, k0, tau0)

      // Particle count
      ctx.fillStyle = 'rgba(30,41,59,0.55)'
      ctx.font      = '10px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`Partículas: ${ps.length}`, 10, H - 10)

      // Paused indicator
      if (!running) {
        ctx.fillStyle = 'rgba(30,41,59,0.30)'
        ctx.font      = 'bold 18px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('⏸ PAUSADO', W / 2, H / 2)
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])  // mount once; isRunning synced via ref

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label="Simulação 2D de Reator CSTR — tanque agitado contínuo"
      style={{
        display     : 'block',
        margin      : '0 auto',
        borderRadius: 14,
        boxShadow   : '0 4px 28px rgba(0,0,0,0.15)',
      }}
    />
  )
}
