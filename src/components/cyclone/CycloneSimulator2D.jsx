/**
 * CycloneSimulator2D.jsx
 * Physics engine : Matter.js  (Runner + Engine only — NO Matter.Render)
 * Rendering      : Plain Canvas 2D  (custom per-frame draw)
 * Palette        : Paul Tol colorblind-safe
 */

import { useRef, useEffect } from 'react'
import Matter from 'matter-js'

// ─── Canvas / geometry constants ───────────────────────────────────────────
const W = 500
const H = 700

const CX         = 250   // horizontal center
const CYL_TOP    = 80    // top of cylinder
const CYL_BOT    = 310   // bottom of cylinder / top of cone
const CONE_BOT   = 480   // apex of cone
const CYL_W      = 160   // cylinder half-width (interior)
const CONE_W_BOT = 18    // cone apex half-width

const BOX_TOP    = 492   // collection box top
const BOX_BOT    = 650   // collection box bottom
const BOX_W      = 130   // box half-width

const OUTLET_W   = 38    // outlet tube half-width
const OUTLET_TOP = 10    // outlet tube top y

const INLET_Y    = 120   // inlet duct centre Y
const INLET_W    = 30    // inlet duct half-height

// ─── Paul Tol palette ──────────────────────────────────────────────────────
const COLOR = {
  veryFine  : '#0077BB',
  fine      : '#33BBEE',
  medium    : '#EE7733',
  coarse    : '#CC3311',
  veryCoarse: '#EE3377',
}
function dpColor(dp) {
  if (dp <  5) return COLOR.veryFine
  if (dp < 15) return COLOR.fine
  if (dp < 30) return COLOR.medium
  if (dp < 60) return COLOR.coarse
  return COLOR.veryCoarse
}

const { Bodies, Body, Composite, Events, Engine, Runner } = Matter

const MAX_PARTICLES = 250
const WALL_T        = 28   // thick walls prevent tunneling

// ─── Static walls ──────────────────────────────────────────────────────────
function createWalls() {
  const wallOpts = {
    isStatic: true, label: 'wall',
    collisionFilter: { category: 0x0001, mask: 0x0002 },
    restitution: 0.05,
    friction: 0.3,
    render: { visible: false },
  }

  const coneH   = CONE_BOT - CYL_BOT                          // 170
  const coneDX  = CYL_W - CONE_W_BOT                          // 142
  const coneLen = Math.sqrt(coneH * coneH + coneDX * coneDX)
  // Correct angle: atan2(Δy, Δx) = atan2(coneH, coneDX) from horizontal
  const coneAng = Math.atan2(coneH, coneDX)

  const walls = [
    // ── Cylinder left wall ──
    Bodies.rectangle(
      CX - CYL_W - WALL_T / 2,
      (CYL_TOP + CYL_BOT) / 2,
      WALL_T, CYL_BOT - CYL_TOP,
      { ...wallOpts }
    ),

    // ── Cylinder right wall — upper (above inlet gap) ──
    Bodies.rectangle(
      CX + CYL_W + WALL_T / 2,
      CYL_TOP + (INLET_Y - INLET_W - CYL_TOP) / 2,
      WALL_T, INLET_Y - INLET_W - CYL_TOP,
      { ...wallOpts }
    ),

    // ── Cylinder right wall — lower (below inlet gap) ──
    Bodies.rectangle(
      CX + CYL_W + WALL_T / 2,
      (INLET_Y + INLET_W + CYL_BOT) / 2,
      WALL_T, CYL_BOT - INLET_Y - INLET_W,
      { ...wallOpts }
    ),

    // ── Cylinder top cap — left of outlet hole ──
    Bodies.rectangle(
      CX - OUTLET_W - (CYL_W - OUTLET_W) / 2,
      CYL_TOP - WALL_T / 2,
      CYL_W - OUTLET_W, WALL_T,
      { ...wallOpts }
    ),

    // ── Cylinder top cap — right of outlet hole ──
    Bodies.rectangle(
      CX + OUTLET_W + (CYL_W - OUTLET_W) / 2,
      CYL_TOP - WALL_T / 2,
      CYL_W - OUTLET_W, WALL_T,
      { ...wallOpts }
    ),

    // ── Outlet tube left wall ──
    Bodies.rectangle(
      CX - OUTLET_W - WALL_T / 2,
      (OUTLET_TOP + CYL_TOP) / 2,
      WALL_T, CYL_TOP - OUTLET_TOP + WALL_T,
      { ...wallOpts }
    ),

    // ── Outlet tube right wall ──
    Bodies.rectangle(
      CX + OUTLET_W + WALL_T / 2,
      (OUTLET_TOP + CYL_TOP) / 2,
      WALL_T, CYL_TOP - OUTLET_TOP + WALL_T,
      { ...wallOpts }
    ),

    // ── Inlet duct top wall ──
    Bodies.rectangle(
      CX + CYL_W + 75,
      INLET_Y - INLET_W - WALL_T / 2,
      150 + WALL_T, WALL_T,
      { ...wallOpts }
    ),

    // ── Inlet duct bottom wall ──
    Bodies.rectangle(
      CX + CYL_W + 75,
      INLET_Y + INLET_W + WALL_T / 2,
      150 + WALL_T, WALL_T,
      { ...wallOpts }
    ),

    // ── Cone left wall (angled: goes down-right) ──
    Bodies.rectangle(
      CX - (CYL_W + CONE_W_BOT) / 2,
      (CYL_BOT + CONE_BOT) / 2,
      coneLen, WALL_T,
      { ...wallOpts, angle: coneAng }
    ),

    // ── Cone right wall (angled: goes down-left) ──
    Bodies.rectangle(
      CX + (CYL_W + CONE_W_BOT) / 2,
      (CYL_BOT + CONE_BOT) / 2,
      coneLen, WALL_T,
      { ...wallOpts, angle: -coneAng }
    ),

    // ── Neck connecting cone to box (left) ──
    Bodies.rectangle(
      CX - CONE_W_BOT - WALL_T / 2,
      (CONE_BOT + BOX_TOP) / 2,
      WALL_T, BOX_TOP - CONE_BOT + WALL_T,
      { ...wallOpts }
    ),

    // ── Neck connecting cone to box (right) ──
    Bodies.rectangle(
      CX + CONE_W_BOT + WALL_T / 2,
      (CONE_BOT + BOX_TOP) / 2,
      WALL_T, BOX_TOP - CONE_BOT + WALL_T,
      { ...wallOpts }
    ),

    // ── Collection box left wall ──
    Bodies.rectangle(
      CX - BOX_W - WALL_T / 2,
      (BOX_TOP + BOX_BOT) / 2,
      WALL_T, BOX_BOT - BOX_TOP + WALL_T,
      { ...wallOpts }
    ),

    // ── Collection box right wall ──
    Bodies.rectangle(
      CX + BOX_W + WALL_T / 2,
      (BOX_TOP + BOX_BOT) / 2,
      WALL_T, BOX_BOT - BOX_TOP + WALL_T,
      { ...wallOpts }
    ),

    // ── Collection box bottom ──
    Bodies.rectangle(
      CX, BOX_BOT + WALL_T / 2,
      BOX_W * 2 + WALL_T * 2, WALL_T,
      { ...wallOpts }
    ),
  ]
  return walls
}

// ─── Particle factory ──────────────────────────────────────────────────────
function spawnParticle() {
  const isHeavy = Math.random() < 0.42
  const r  = isHeavy ? 4 + Math.random() * 3 : 2 + Math.random() * 2
  const dp = isHeavy ? 30 + Math.random() * 70 : 2 + Math.random() * 18

  // Spawn strictly inside the inlet gap
  const x = CX + CYL_W - r - 2
  const y = INLET_Y + (Math.random() - 0.5) * (INLET_W * 1.2)

  const body = Bodies.circle(x, y, r, {
    label: 'particle',
    restitution: 0.12,
    friction: 0.06,
    frictionAir: isHeavy ? 0.025 : 0.06,
    collisionFilter: { category: 0x0002, mask: 0x0001 },
    slop: 0.01,
  })

  body.isHeavy = isHeavy
  body.dp      = dp
  body.color   = dpColor(dp)

  Body.setMass(body, isHeavy ? r * r * 0.9 : r * r * 0.25)

  // Moderate entry speed (avoid tunneling)
  const speed = 2.2 + Math.random() * 1.5
  Body.setVelocity(body, { x: -speed, y: (Math.random() - 0.5) * 1.0 })

  return body
}

// ─── Custom cyclone forces ──────────────────────────────────────────────────
function makeForceHandler(engine) {
  return function applyForces() {
    const bodies = Composite.allBodies(engine.world)

    for (const body of bodies) {
      if (body.label !== 'particle') continue

      const x  = body.position.x
      const y  = body.position.y
      const dx = x - CX
      const vx = body.velocity.x
      const vy = body.velocity.y
      const m  = body.mass
      const r  = body.circleRadius || 3

      const inCylinder = y > CYL_TOP + 10 && y < CYL_BOT
      const inCone     = y >= CYL_BOT     && y < CONE_BOT
      const inOutlet   = x > CX - OUTLET_W && x < CX + OUTLET_W && y < CYL_TOP + 20

      // ── Manual hard-wall clamping (fallback for tunneling) ──────────────
      if (inCylinder) {
        if (x > CX + CYL_W - r) {
          Body.setPosition(body, { x: CX + CYL_W - r, y })
          Body.setVelocity(body, { x: -Math.abs(vx) * 0.1, y: vy })
        }
        if (x < CX - CYL_W + r) {
          Body.setPosition(body, { x: CX - CYL_W + r, y })
          Body.setVelocity(body, { x:  Math.abs(vx) * 0.1, y: vy })
        }
      }

      // ── Clamp inside cone (linear narrowing) ────────────────────────────
      if (inCone) {
        const t = (y - CYL_BOT) / (CONE_BOT - CYL_BOT)
        const maxR = CYL_W * (1 - t) + CONE_W_BOT * t - r
        if (Math.abs(dx) > maxR) {
          Body.setPosition(body, { x: CX + Math.sign(dx) * maxR, y })
          Body.setVelocity(body, { x: -vx * 0.1, y: vy })
        }
      }

      // ── Cyclone physics forces ──────────────────────────────────────────
      if (inCylinder || inCone) {
        // Swirl: maintain spiral orbit
        const swirlStr = body.isHeavy ? 0.0004 : 0.00018
        Body.applyForce(body, body.position, {
          x: (-vy * 0.15 - vx) * swirlStr * m,
          y: ( vx * 0.15 - vy) * swirlStr * m,
        })

        if (body.isHeavy) {
          // Centrifugal: push heavy particles toward outer wall
          const centF = 0.0003 * m * (Math.abs(dx) / CYL_W + 0.35)
          Body.applyForce(body, body.position, {
            x: Math.sign(dx || 1) * centF,
            y: 0,
          })
        } else {
          // Gas drag: pull light particles toward axis
          Body.applyForce(body, body.position, {
            x: -dx * 0.00022 * m,
            y: 0,
          })
          // Inner vortex updraft near centre
          if (Math.abs(dx) < CYL_W * 0.45) {
            Body.applyForce(body, body.position, { x: 0, y: -0.00055 * m })
          }
        }
      }

      // ── Outlet jet: shoot fine particles upward ─────────────────────────
      if (inOutlet && !body.isHeavy) {
        Body.applyForce(body, body.position, { x: 0, y: -0.001 * m })
      }

      // ── Kill out-of-bounds particles ────────────────────────────────────
      if (y < OUTLET_TOP - 20 || y > BOX_BOT + 40 || x < -40 || x > W + 40) {
        Composite.remove(engine.world, body)
      }
    }
  }
}

// ─── Canvas renderer ───────────────────────────────────────────────────────
function drawStructure(ctx) {
  ctx.lineWidth   = 5
  ctx.strokeStyle = '#2a5c6e'

  // Cylinder body
  ctx.fillStyle = 'rgba(58,125,148,0.13)'
  ctx.beginPath()
  ctx.rect(CX - CYL_W, CYL_TOP, CYL_W * 2, CYL_BOT - CYL_TOP)
  ctx.fill(); ctx.stroke()

  // Cone body
  ctx.beginPath()
  ctx.moveTo(CX - CYL_W,      CYL_BOT)
  ctx.lineTo(CX - CONE_W_BOT, CONE_BOT)
  ctx.lineTo(CX + CONE_W_BOT, CONE_BOT)
  ctx.lineTo(CX + CYL_W,      CYL_BOT)
  ctx.closePath()
  ctx.fill(); ctx.stroke()

  // Neck cone → box
  ctx.beginPath()
  ctx.rect(CX - CONE_W_BOT, CONE_BOT, CONE_W_BOT * 2, BOX_TOP - CONE_BOT)
  ctx.fill(); ctx.stroke()

  // Collection box
  ctx.fillStyle = 'rgba(58,125,148,0.09)'
  ctx.beginPath()
  ctx.rect(CX - BOX_W, BOX_TOP, BOX_W * 2, BOX_BOT - BOX_TOP)
  ctx.fill(); ctx.stroke()

  // Outlet tube
  ctx.fillStyle = 'rgba(91,200,245,0.28)'
  ctx.beginPath()
  ctx.rect(CX - OUTLET_W, OUTLET_TOP, OUTLET_W * 2, CYL_TOP - OUTLET_TOP + 10)
  ctx.fill(); ctx.stroke()

  // Inlet duct
  ctx.fillStyle = 'rgba(30,77,92,0.35)'
  ctx.beginPath()
  ctx.rect(CX + CYL_W, INLET_Y - INLET_W, 90, INLET_W * 2)
  ctx.fill(); ctx.stroke()

  // Labels
  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('↑ Saída (Overflow)', CX, OUTLET_TOP - 4)
  ctx.textAlign = 'left'
  ctx.fillText('→ Entrada', CX + CYL_W + 8, INLET_Y - INLET_W - 5)
  ctx.textAlign = 'center'
  ctx.fillText('Coletor de Pó', CX, BOX_BOT - 8)
}

function draw(ctx, engine) {
  ctx.clearRect(0, 0, W, H)

  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#dbeafe')
  grad.addColorStop(1, '#f0f4f8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  drawStructure(ctx)

  const bodies = Composite.allBodies(engine.world)
  let pCount = 0
  for (const body of bodies) {
    if (body.label !== 'particle') continue
    pCount++
    const r = body.circleRadius || 3
    ctx.beginPath()
    ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2)
    ctx.fillStyle = body.color || '#888888'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'
    ctx.lineWidth   = 0.7
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(30,41,59,0.65)'
  ctx.font      = '11px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`Partículas: ${pCount}`, 10, H - 10)
}

// ─── Main component ────────────────────────────────────────────────────────
export default function CycloneSimulator2D({ isRunning = true }) {
  const canvasRef    = useRef(null)
  const engineRef    = useRef(null)
  const runnerRef    = useRef(null)
  const spawnerRef   = useRef(null)
  const animFrameRef = useRef(null)
  const isRunningRef = useRef(isRunning)

  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const engine = Engine.create({
      gravity: { x: 0, y: 0.9 },
      positionIterations: 12,
      velocityIterations: 12,
      constraintIterations: 4,
    })
    engineRef.current = engine

    Composite.add(engine.world, createWalls())

    const forceHandler = makeForceHandler(engine)
    Events.on(engine, 'beforeUpdate', forceHandler)

    const runner = Runner.create({ isFixed: false })
    runnerRef.current = runner

    spawnerRef.current = setInterval(() => {
      if (!isRunningRef.current) return
      const count = Composite.allBodies(engine.world).filter(b => b.label === 'particle').length
      if (count >= MAX_PARTICLES) return
      Composite.add(engine.world, spawnParticle())
    }, 120)

    function loop() {
      Runner.tick(runner, engine, 1000 / 60)
      draw(ctx, engine)
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      clearInterval(spawnerRef.current)
      Events.off(engine, 'beforeUpdate', forceHandler)
      Runner.stop(runner)
      Engine.clear(engine)
    }
  }, [])

  useEffect(() => {
    if (!engineRef.current) return
    engineRef.current.timing.timeScale = isRunning ? 1 : 0
  }, [isRunning])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label="Simulação 2D de separador ciclônico"
      style={{ display: 'block', margin: '0 auto', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.14)' }}
    />
  )
}
