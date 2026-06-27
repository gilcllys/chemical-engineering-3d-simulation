/**
 * CycloneSimulator2D.jsx
 * ──────────────────────
 * 2-D cyclone separator simulation.
 * Physics engine : Matter.js  (Runner + Engine only — NO Matter.Render)
 * Rendering      : Plain Canvas 2D  (custom per-frame draw)
 * Palette        : Paul Tol colorblind-safe
 */

import { useRef, useEffect, useCallback } from 'react'
import Matter from 'matter-js'

// ─── Canvas / geometry constants ───────────────────────────────────────────
const W = 500
const H = 700

const CX          = 250   // horizontal center
const CYL_TOP     = 60    // top of cylinder (where outlet tube starts)
const CYL_BOT     = 300   // bottom of cylinder / top of cone
const CONE_BOT    = 480   // apex of cone
const CYL_W       = 180   // cylinder half-width
const CONE_W_BOT  = 15    // cone apex half-width

const BOX_TOP     = 490   // collection box top
const BOX_BOT     = 640   // collection box bottom
const BOX_W       = 140   // box half-width

const OUTLET_W    = 40    // outlet tube half-width
const OUTLET_TOP  = 10    // outlet tube top y

const INLET_Y     = 100   // inlet duct centre Y
const INLET_W     = 35    // inlet duct half-height

// ─── Paul Tol palette ──────────────────────────────────────────────────────
const COLOR = {
  veryFine  : '#0077BB',   // < 5 µm   – blue
  fine      : '#33BBEE',   // 5–15 µm  – light blue
  medium    : '#EE7733',   // 15–30 µm – orange
  coarse    : '#CC3311',   // 30–60 µm – red-orange
  veryCoarse: '#EE3377',   // > 60 µm  – pink-red
}

function dpColor(dp) {
  if (dp <  5) return COLOR.veryFine
  if (dp < 15) return COLOR.fine
  if (dp < 30) return COLOR.medium
  if (dp < 60) return COLOR.coarse
  return COLOR.veryCoarse
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const { Bodies, Body, Composite, Events, Engine, Runner } = Matter

const MAX_PARTICLES = 300
const WALL_T        = 6

// ─── Static walls ──────────────────────────────────────────────────────────
function createWalls() {
  const wallOpts = { isStatic: true, label: 'wall',
    collisionFilter: { category: 0x0001 },
    render: { visible: false },
    restitution: 0.1, friction: 0.05,
  }

  // ── Cone geometry ──
  const coneH    = CONE_BOT - CYL_BOT
  const coneDX   = CYL_W - CONE_W_BOT
  const coneLen  = Math.sqrt(coneH * coneH + coneDX * coneDX)
  const coneAng  = Math.atan2(coneDX, coneH)

  // ── Inlet duct top/bottom  ──
  const inletDuctX   = CX + CYL_W + 100          // horizontal mid of inlet duct slab
  const inletDuctLen = 200

  return [
    // Cylinder left wall
    Bodies.rectangle(
      CX - CYL_W - WALL_T / 2,
      (CYL_TOP + CYL_BOT) / 2,
      WALL_T, CYL_BOT - CYL_TOP,
      { ...wallOpts }
    ),

    // Cylinder right wall — upper part (above inlet gap)
    Bodies.rectangle(
      CX + CYL_W + WALL_T / 2,
      (CYL_TOP + INLET_Y - INLET_W) / 2,
      WALL_T, INLET_Y - INLET_W - CYL_TOP,
      { ...wallOpts }
    ),

    // Cylinder right wall — lower part (below inlet gap)
    Bodies.rectangle(
      CX + CYL_W + WALL_T / 2,
      (INLET_Y + INLET_W + CYL_BOT) / 2,
      WALL_T, CYL_BOT - (INLET_Y + INLET_W),
      { ...wallOpts }
    ),

    // Cylinder top cap — left ring (keeps outlet hole open)
    Bodies.rectangle(
      (CX - OUTLET_W + CX - CYL_W) / 2,
      CYL_TOP,
      CYL_W - OUTLET_W, WALL_T,
      { ...wallOpts }
    ),

    // Cylinder top cap — right ring
    Bodies.rectangle(
      (CX + OUTLET_W + CX + CYL_W) / 2,
      CYL_TOP,
      CYL_W - OUTLET_W, WALL_T,
      { ...wallOpts }
    ),

    // Outlet tube — left wall
    Bodies.rectangle(
      CX - OUTLET_W - WALL_T / 2,
      (OUTLET_TOP + CYL_TOP + 80) / 2,
      WALL_T, CYL_TOP - OUTLET_TOP + 80,
      { ...wallOpts }
    ),

    // Outlet tube — right wall
    Bodies.rectangle(
      CX + OUTLET_W + WALL_T / 2,
      (OUTLET_TOP + CYL_TOP + 80) / 2,
      WALL_T, CYL_TOP - OUTLET_TOP + 80,
      { ...wallOpts }
    ),

    // Inlet duct — top wall
    Bodies.rectangle(
      inletDuctX,
      INLET_Y - INLET_W - WALL_T / 2,
      inletDuctLen, WALL_T,
      { ...wallOpts }
    ),

    // Inlet duct — bottom wall
    Bodies.rectangle(
      inletDuctX,
      INLET_Y + INLET_W + WALL_T / 2,
      inletDuctLen, WALL_T,
      { ...wallOpts }
    ),

    // Cone left wall (angled)
    Bodies.rectangle(
      CX - (CYL_W + CONE_W_BOT) / 2,
      (CYL_BOT + CONE_BOT) / 2,
      coneLen, WALL_T,
      { ...wallOpts, angle: -coneAng }
    ),

    // Cone right wall (angled)
    Bodies.rectangle(
      CX + (CYL_W + CONE_W_BOT) / 2,
      (CYL_BOT + CONE_BOT) / 2,
      coneLen, WALL_T,
      { ...wallOpts, angle: coneAng }
    ),

    // Collection box — left wall
    Bodies.rectangle(
      CX - BOX_W - WALL_T / 2,
      (BOX_TOP + BOX_BOT) / 2,
      WALL_T, BOX_BOT - BOX_TOP,
      { ...wallOpts }
    ),

    // Collection box — right wall
    Bodies.rectangle(
      CX + BOX_W + WALL_T / 2,
      (BOX_TOP + BOX_BOT) / 2,
      WALL_T, BOX_BOT - BOX_TOP,
      { ...wallOpts }
    ),

    // Collection box — bottom
    Bodies.rectangle(
      CX, BOX_BOT + WALL_T / 2,
      BOX_W * 2 + WALL_T * 2, WALL_T,
      { ...wallOpts }
    ),
  ]
}

// ─── Particle factory ──────────────────────────────────────────────────────
function spawnParticle() {
  const isHeavy = Math.random() < 0.40

  const r    = isHeavy ? 4 + Math.random() * 4 : 2 + Math.random() * 2
  const dp   = isHeavy ? 30 + Math.random() * 70 : 2 + Math.random() * 18
  const x    = CX + CYL_W - 20
  const y    = INLET_Y + (Math.random() - 0.5) * INLET_W * 1.4

  const body = Bodies.circle(x, y, r, {
    label      : 'particle',
    restitution: 0.15,
    friction   : 0.05,
    frictionAir: isHeavy ? 0.018 : 0.055,
    collisionFilter: { category: 0x0002, mask: 0x0001 },
  })

  // Assign custom props directly on the body object
  body.isHeavy   = isHeavy
  body.dp        = dp
  body.color     = dpColor(dp)
  body.spawnTime = Date.now()

  // Override mass to match the original spec
  Body.setMass(body, isHeavy ? r * r * 0.8 : r * r * 0.2)

  // Initial velocity: leftward tangential entry
  const speed = 3 + Math.random() * 2
  Body.setVelocity(body, { x: -speed, y: (Math.random() - 0.5) * 1.5 })

  return body
}

// ─── Custom cyclone forces (called every beforeUpdate) ─────────────────────
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

      const inCylinder = y > CYL_TOP + 20  && y < CYL_BOT
      const inCone     = y >= CYL_BOT       && y < CONE_BOT
      const inOutlet   = x > CX - OUTLET_W  && x < CX + OUTLET_W && y < CYL_TOP + 80

      if (inCylinder || inCone) {
        // ── Swirl: maintain circular orbit ──
        const swirlStrength = body.isHeavy ? 0.00035 : 0.00015
        const targetVx = -vy * 0.15
        const targetVy =  vx * 0.15
        Body.applyForce(body, body.position, {
          x: (targetVx - vx) * swirlStrength * m,
          y: (targetVy - vy) * swirlStrength * m,
        })

        if (body.isHeavy) {
          // ── Centrifugal: push heavy particles outward ──
          const centF = 0.00028 * m * (Math.abs(dx) / 100 + 0.3)
          Body.applyForce(body, body.position, {
            x: Math.sign(dx || 1) * centF,
            y: 0,
          })
        } else {
          // ── Gas drag: pull light particles toward axis ──
          Body.applyForce(body, body.position, {
            x: -dx * 0.00018 * m,
            y: 0,
          })

          // ── Inner vortex updraft when near centre ──
          if (Math.abs(dx) < CYL_W * 0.45) {
            Body.applyForce(body, body.position, {
              x: 0,
              y: -0.00045 * m,
            })
          }
        }
      }

      // ── Outlet jet: strong upward force for fine particles ──
      if (inOutlet && !body.isHeavy) {
        Body.applyForce(body, body.position, {
          x: 0,
          y: -0.0009 * m,
        })
      }

      // ── Kill particles that leave the canvas ──
      if (y < -20 || y > BOX_BOT + 50 || x < -50 || x > 600) {
        Composite.remove(engine.world, body)
      }
    }
  }
}

// ─── Canvas renderer ───────────────────────────────────────────────────────
function drawCycloneStructure(ctx) {
  // ── Cylinder ──
  ctx.strokeStyle = '#2a5c6e'
  ctx.lineWidth   = 5
  ctx.fillStyle   = 'rgba(58,125,148,0.13)'
  ctx.beginPath()
  ctx.rect(CX - CYL_W, CYL_TOP, CYL_W * 2, CYL_BOT - CYL_TOP)
  ctx.fill()
  ctx.stroke()

  // ── Cone ──
  ctx.beginPath()
  ctx.moveTo(CX - CYL_W,      CYL_BOT)
  ctx.lineTo(CX - CONE_W_BOT, CONE_BOT)
  ctx.lineTo(CX + CONE_W_BOT, CONE_BOT)
  ctx.lineTo(CX + CYL_W,      CYL_BOT)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // ── Outlet tube ──
  ctx.fillStyle   = 'rgba(91,200,245,0.28)'
  ctx.strokeStyle = '#2a5c6e'
  ctx.beginPath()
  ctx.rect(CX - OUTLET_W, OUTLET_TOP, OUTLET_W * 2, CYL_TOP + 60 - OUTLET_TOP)
  ctx.fill()
  ctx.stroke()

  // ── Inlet duct ──
  ctx.fillStyle = 'rgba(30,77,92,0.38)'
  ctx.beginPath()
  ctx.rect(CX + CYL_W, INLET_Y - INLET_W, 90, INLET_W * 2)
  ctx.fill()
  ctx.stroke()

  // ── Collection box ──
  ctx.strokeStyle = '#2a5c6e'
  ctx.fillStyle   = 'rgba(58,125,148,0.09)'
  ctx.beginPath()
  ctx.rect(CX - BOX_W, BOX_TOP, BOX_W * 2, BOX_BOT - BOX_TOP)
  ctx.fill()
  ctx.stroke()

  // ── Connecting neck between cone apex and box ──
  ctx.fillStyle   = 'rgba(58,125,148,0.13)'
  ctx.strokeStyle = '#2a5c6e'
  ctx.lineWidth   = 4
  ctx.beginPath()
  ctx.rect(CX - CONE_W_BOT - 4, CONE_BOT, (CONE_W_BOT + 4) * 2, BOX_TOP - CONE_BOT)
  ctx.fill()
  ctx.stroke()

  // ── Flow direction arrows ──
  ctx.fillStyle  = 'rgba(42,92,110,0.55)'
  ctx.font       = '13px sans-serif'
  ctx.textAlign  = 'center'
  // Outlet arrow
  ctx.fillText('↑', CX, OUTLET_TOP - 6)

  // Inlet arrow
  ctx.textAlign = 'left'
  ctx.fillText('→', CX + CYL_W + 68, INLET_Y + 4)

  // ── Labels ──
  ctx.fillStyle  = '#1e293b'
  ctx.font       = 'bold 11px sans-serif'
  ctx.textAlign  = 'center'

  ctx.fillText('Saída (Overflow)', CX, OUTLET_TOP - 18)

  ctx.textAlign = 'left'
  ctx.fillText('Entrada', CX + CYL_W + 10, INLET_Y - INLET_W - 6)

  ctx.textAlign = 'center'
  ctx.fillText('Coletor de Pó', CX, BOX_BOT - 10)
}

function draw(ctx, engine) {
  ctx.clearRect(0, 0, W, H)

  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#dbeafe')
  grad.addColorStop(1, '#f0f4f8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Structure
  drawCycloneStructure(ctx)

  // Particles
  const bodies = Composite.allBodies(engine.world)
  for (const body of bodies) {
    if (body.label !== 'particle') continue
    const r = body.circleRadius || 3
    ctx.beginPath()
    ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2)
    ctx.fillStyle = body.color || '#888888'
    ctx.fill()
    // Subtle rim so small particles stay readable
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth   = 0.8
    ctx.stroke()
  }

  // Particle count HUD
  const pCount = bodies.filter(b => b.label === 'particle').length
  ctx.fillStyle  = 'rgba(30,41,59,0.7)'
  ctx.font       = '11px monospace'
  ctx.textAlign  = 'left'
  ctx.fillText(`Partículas: ${pCount}`, 10, H - 10)
}

// ─── Main component ────────────────────────────────────────────────────────
export default function CycloneSimulator2D({ isRunning = true }) {
  const canvasRef    = useRef(null)
  const engineRef    = useRef(null)
  const runnerRef    = useRef(null)
  const spawnerRef   = useRef(null)
  const animFrameRef = useRef(null)

  // Stable ref to track isRunning without re-creating the engine
  const isRunningRef = useRef(isRunning)
  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  // ── Mount / unmount: build the world once ──────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')

    // Engine
    const engine = Engine.create({ gravity: { x: 0, y: 0.8 } })
    engineRef.current = engine

    // Walls
    Composite.add(engine.world, createWalls())

    // Custom force handler
    const forceHandler = makeForceHandler(engine)
    Events.on(engine, 'beforeUpdate', forceHandler)

    // Runner
    const runner = Runner.create()
    runnerRef.current = runner

    // Particle spawner
    spawnerRef.current = setInterval(() => {
      if (!isRunningRef.current) return
      const count = Composite.allBodies(engine.world).filter(b => b.label === 'particle').length
      if (count >= MAX_PARTICLES) return
      Composite.add(engine.world, spawnParticle())
    }, 110)

    // Animation loop
    function loop() {
      // Advance physics only while running (timeScale handles pause)
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
  }, []) // run once on mount

  // ── Pause / resume via timeScale ──────────────────────────────────────
  useEffect(() => {
    if (!engineRef.current) return
    engineRef.current.timing.timeScale = isRunning ? 1 : 0
  }, [isRunning])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-label="Simulação 2D de separador ciclônico"
      role="img"
      style={{
        display     : 'block',
        margin      : '0 auto',
        borderRadius: 12,
        boxShadow   : '0 4px 24px rgba(0,0,0,0.14)',
      }}
    />
  )
}
