/**
 * CycloneSimulator2D.jsx
 * Simulação 2D do ciclone separador — corte transversal.
 * Física: JS puro (sem Matter.js), igual ao padrão do simulador 3D.
 * Renderização: Canvas 2D customizado.
 * Paleta: Paul Tol (acessível a daltônicos).
 */

import { useRef, useEffect } from 'react'

// ── Dimensões do canvas ─────────────────────────────────────────────────────
const W = 480
const H = 720

// ── Geometria do ciclone (pixels) ──────────────────────────────────────────
const CX          = 240   // eixo central
const CYL_TOP     = 85    // topo do cilindro
const CYL_BOT     = 315   // base do cilindro / topo do cone
const CONE_BOT    = 490   // apex do cone
const CYL_W       = 150   // meia-largura do cilindro
const CONE_W_BOT  = 18    // meia-largura do apex
const BOX_TOP     = 500   // topo da caixa coletora
const BOX_BOT     = 655   // fundo da caixa coletora
const BOX_W       = 125   // meia-largura da caixa
const OUTLET_W    = 36    // meia-largura do tubo de saída
const OUTLET_TOP  = 8     // topo do tubo de saída (sai pela borda superior)
const INLET_Y     = 135   // centro vertical da entrada
const INLET_W     = 30    // meia-altura da entrada

// ── Paleta Paul Tol ──────────────────────────────────────────────────────────
function dpColor(dp) {
  if (dp <  5) return '#0077BB'   // azul       – muito fino
  if (dp < 15) return '#33BBEE'   // azul claro – fino
  if (dp < 30) return '#EE7733'   // laranja    – médio
  if (dp < 60) return '#CC3311'   // vermelho   – grosso
  return             '#EE3377'    // rosa       – muito grosso
}

// ── Fábrica de partículas ────────────────────────────────────────────────────
function makeParticle() {
  const isHeavy = Math.random() < 0.42
  const r  = isHeavy ? 4 + Math.random() * 3.5 : 2 + Math.random() * 2
  const dp = isHeavy ? 30 + Math.random() * 70  : 2 + Math.random() * 18
  return {
    x: CX + CYL_W - r - 2,
    y: INLET_Y + (Math.random() - 0.5) * INLET_W * 1.6,
    vx: -(60 + Math.random() * 50),   // px/s — entrando da direita
    vy: (Math.random() - 0.5) * 25,
    r, dp, isHeavy,
    color: dpColor(dp),
    phase: 'entering',   // entering | outer | inner | cone | box | outlet
    osc: Math.random() * Math.PI * 2,  // fase da oscilação da espiral
    alive: true,
  }
}

// ── Geometria auxiliar ───────────────────────────────────────────────────────
/** Largura interior máxima do ciclone em y (cone se estreita linearmente) */
function interiorHalfW(y) {
  if (y < CYL_TOP)  return OUTLET_W
  if (y <= CYL_BOT) return CYL_W
  if (y <= CONE_BOT) {
    const t = (y - CYL_BOT) / (CONE_BOT - CYL_BOT)
    return CYL_W * (1 - t) + CONE_W_BOT * t
  }
  if (y <= BOX_TOP)  return CONE_W_BOT
  return BOX_W
}

// ── Loop de física — dt em segundos ─────────────────────────────────────────
const GRAVITY    = 380   // px/s²
const BOUNCE     = 0.08  // restituição nas paredes
const FLOOR_FRIC = 0.55  // fricção no fundo da caixa

function stepParticle(p, dt) {
  const { r } = p

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: entering — move para a esquerda até atingir a metade do cilindro
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'entering') {
    p.vx -= 40 * dt   // desacelera levemente
    p.x  += p.vx * dt
    p.y  += p.vy * dt

    // Colisão topo/fundo cilindro
    if (p.y < CYL_TOP + r) { p.y = CYL_TOP + r; p.vy = Math.abs(p.vy) * BOUNCE }
    if (p.y > CYL_BOT - r) { p.y = CYL_BOT - r; p.vy = -Math.abs(p.vy) * BOUNCE }

    // Transição quando cruza o eixo central
    if (p.x <= CX + 15) {
      if (p.isHeavy) {
        p.phase = 'outer'
        p.vy = 55 + Math.random() * 40
        p.vx = (Math.random() - 0.5) * 40
      } else {
        p.phase = 'inner'
        p.vy = -(90 + Math.random() * 70)
        p.vx = (p.x > CX ? -1 : 1) * (20 + Math.random() * 20)
      }
    }
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: outer — partícula pesada espirala pela parede e desce
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'outer') {
    p.osc += 2.8 * dt

    // Força centrífuga: empurra para a parede
    const dx = p.x - CX
    const centrifugal = 260 * (Math.abs(dx) / CYL_W + 0.28) * Math.sign(dx || 1)
    p.vx += centrifugal * dt

    // Oscilação horizontal: simula projeção 2D da espiral
    p.vx += Math.cos(p.osc) * 120 * dt

    // Gravidade / descida axial
    p.vy += GRAVITY * 0.55 * dt

    // Amortecimento (arrasto do ar)
    p.vx *= 1 - 1.8 * dt
    p.vy *= 1 - 0.5 * dt

    p.x += p.vx * dt
    p.y += p.vy * dt

    // Colisão com as paredes do cilindro
    if (p.x > CX + CYL_W - r) { p.x = CX + CYL_W - r; p.vx = -Math.abs(p.vx) * BOUNCE }
    if (p.x < CX - CYL_W + r) { p.x = CX - CYL_W + r; p.vx =  Math.abs(p.vx) * BOUNCE }
    if (p.y < CYL_TOP + r)    { p.y = CYL_TOP + r;     p.vy =  Math.abs(p.vy) * BOUNCE }

    if (p.y > CYL_BOT - r) {
      p.phase = 'cone'
      p.vy = Math.max(p.vy, 70)
    }
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: inner — partícula leve sobe pelo vórtice interno
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'inner') {
    // Puxa para o eixo central
    const dx = p.x - CX
    p.vx += -dx * 5 * dt
    p.vx *= 1 - 3.5 * dt

    // Força de sustentação para cima
    p.vy += (-260 - p.vy * 1.8) * dt

    p.x += p.vx * dt
    p.y += p.vy * dt

    // Confinamento nas paredes do cilindro
    if (Math.abs(p.x - CX) > CYL_W - r) {
      p.x = CX + Math.sign(p.x - CX) * (CYL_W - r)
      p.vx *= -BOUNCE
    }
    // Tampa superior: só passa se estiver dentro do tubo de saída
    if (p.y < CYL_TOP + r) {
      if (Math.abs(p.x - CX) < OUTLET_W - r) {
        p.phase = 'outlet'
        p.vy = -(130 + Math.random() * 60)
        p.vx *= 0.25
      } else {
        p.y = CYL_TOP + r
        p.vy = Math.abs(p.vy) * 0.2
      }
    }
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: cone — desce pelo cone, convergindo para o apex
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'cone') {
    p.vy += GRAVITY * 0.75 * dt
    p.vx *= 1 - 2.2 * dt

    p.x += p.vx * dt
    p.y += p.vy * dt

    const maxX = CX + interiorHalfW(p.y) - r
    const minX = CX - interiorHalfW(p.y) + r
    if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx) * BOUNCE }
    if (p.x < minX) { p.x = minX; p.vx =  Math.abs(p.vx) * BOUNCE }

    if (p.y > CONE_BOT) {
      p.phase = 'box'
      p.y = BOX_TOP + r + 2
      p.vy = Math.max(p.vy * 0.55, 50)
      p.vx = (Math.random() - 0.5) * (BOX_W * 1.4)
    }
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: box — acumula na caixa coletora com gravidade e fricção
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'box') {
    p.vy += GRAVITY * dt
    p.x  += p.vx * dt
    p.y  += p.vy * dt

    // Fundo
    if (p.y > BOX_BOT - r) {
      p.y  = BOX_BOT - r
      p.vy = -Math.abs(p.vy) * 0.05
      p.vx *= 0.88  // desliza bastante antes de parar
    }
    // Paredes laterais
    if (p.x > CX + BOX_W - r) { p.x = CX + BOX_W - r; p.vx = -Math.abs(p.vx) * BOUNCE }
    if (p.x < CX - BOX_W + r) { p.x = CX - BOX_W + r; p.vx =  Math.abs(p.vx) * BOUNCE }
    // Topo da caixa (não deixa escapar para cima)
    if (p.y < BOX_TOP + r) { p.y = BOX_TOP + r; p.vy = Math.abs(p.vy) * 0.1 }

    // Amortecimento geral
    p.vx *= 1 - 0.6 * dt
    p.vy *= 1 - 0.2 * dt
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FASE: outlet — sobe pelo tubo de saída e sai pelo topo
  // ──────────────────────────────────────────────────────────────────────────
  if (p.phase === 'outlet') {
    p.vy += -140 * dt   // aceleração adicional para cima
    p.vx *= 1 - 4.5 * dt

    if (p.x > CX + OUTLET_W - r) { p.x = CX + OUTLET_W - r; p.vx = -Math.abs(p.vx) * BOUNCE }
    if (p.x < CX - OUTLET_W + r) { p.x = CX - OUTLET_W + r; p.vx =  Math.abs(p.vx) * BOUNCE }

    p.x += p.vx * dt
    p.y += p.vy * dt

    if (p.y < OUTLET_TOP - 15) p.alive = false
    return
  }
}


// ── Colisão partícula-partícula (separação posicional + impulso) ─────────────
const RELAX_ITERS = 3
function resolveCollisions(pool) {
  // Apenas partículas que já estão na caixa ou em queda no cone
  const active = pool.filter(p => p.phase === 'box' || p.phase === 'cone')
  const n = active.length
  if (n < 2) return

  for (let iter = 0; iter < RELAX_ITERS; iter++) {
    for (let i = 0; i < n; i++) {
      const a = active[i]
      for (let j = i + 1; j < n; j++) {
        const b = active[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const minDist = a.r + b.r
        if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) continue  // early-out
        const dist2 = dx * dx + dy * dy
        if (dist2 >= minDist * minDist || dist2 < 0.0001) continue

        const dist    = Math.sqrt(dist2)
        const overlap = (minDist - dist) * 0.52
        const nx = dx / dist
        const ny = dy / dist

        // Empurra igualmente nos dois sentidos
        a.x -= nx * overlap;  a.y -= ny * overlap
        b.x += nx * overlap;  b.y += ny * overlap

        // Impulso de velocidade (restituição baixa = comportamento de areia)
        const relVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (relVn < 0) {
          const imp = relVn * 0.55
          a.vx += imp * nx;  a.vy += imp * ny
          b.vx -= imp * nx;  b.vy -= imp * ny
        }
      }
    }

    // ── Clamp de bounds após cada iteração: garante que nenhuma partícula
    //    saia dos limites da caixa ou do cone por causa da separação ──────────
    for (let i = 0; i < n; i++) {
      const p = active[i]
      const r = p.r

      if (p.phase === 'box') {
        // Fundo
        if (p.y > BOX_BOT - r) {
          p.y = BOX_BOT - r
          if (p.vy > 0) p.vy = -Math.abs(p.vy) * 0.05
        }
        // Topo da caixa
        if (p.y < BOX_TOP + r) {
          p.y = BOX_TOP + r
          if (p.vy < 0) p.vy = Math.abs(p.vy) * 0.05
        }
        // Parede direita
        if (p.x > CX + BOX_W - r) {
          p.x = CX + BOX_W - r
          if (p.vx > 0) p.vx = -Math.abs(p.vx) * 0.05
        }
        // Parede esquerda
        if (p.x < CX - BOX_W + r) {
          p.x = CX - BOX_W + r
          if (p.vx < 0) p.vx = Math.abs(p.vx) * 0.05
        }
      } else if (p.phase === 'cone') {
        // Mantém dentro do cone usando interiorHalfW
        const hw = interiorHalfW(p.y) - r
        if (p.x > CX + hw) { p.x = CX + hw; if (p.vx > 0) p.vx = -Math.abs(p.vx) * 0.3 }
        if (p.x < CX - hw) { p.x = CX - hw; if (p.vx < 0) p.vx =  Math.abs(p.vx) * 0.3 }
        if (p.y < CYL_BOT + r) { p.y = CYL_BOT + r; if (p.vy < 0) p.vy = Math.abs(p.vy) * 0.1 }
      }
    }
  }
}

// ── Renderização ─────────────────────────────────────────────────────────────
function drawStructure(ctx) {
  ctx.lineWidth   = 5
  ctx.strokeStyle = '#2a5c6e'

  // Cilindro
  ctx.fillStyle = 'rgba(58,125,148,0.13)'
  ctx.beginPath(); ctx.rect(CX - CYL_W, CYL_TOP, CYL_W * 2, CYL_BOT - CYL_TOP); ctx.fill(); ctx.stroke()

  // Cone
  ctx.beginPath()
  ctx.moveTo(CX - CYL_W, CYL_BOT); ctx.lineTo(CX - CONE_W_BOT, CONE_BOT)
  ctx.lineTo(CX + CONE_W_BOT, CONE_BOT); ctx.lineTo(CX + CYL_W, CYL_BOT)
  ctx.closePath(); ctx.fill(); ctx.stroke()

  // Pescoço (cone → caixa)
  ctx.beginPath(); ctx.rect(CX - CONE_W_BOT, CONE_BOT, CONE_W_BOT * 2, BOX_TOP - CONE_BOT); ctx.fill(); ctx.stroke()

  // Caixa coletora
  ctx.fillStyle = 'rgba(58,125,148,0.09)'
  ctx.beginPath(); ctx.rect(CX - BOX_W, BOX_TOP, BOX_W * 2, BOX_BOT - BOX_TOP); ctx.fill(); ctx.stroke()

  // Tubo de saída
  ctx.fillStyle = 'rgba(91,200,245,0.28)'
  ctx.beginPath(); ctx.rect(CX - OUTLET_W, OUTLET_TOP, OUTLET_W * 2, CYL_TOP - OUTLET_TOP + 12); ctx.fill(); ctx.stroke()

  // Duto de entrada
  ctx.fillStyle = 'rgba(30,77,92,0.35)'
  ctx.beginPath(); ctx.rect(CX + CYL_W, INLET_Y - INLET_W, 88, INLET_W * 2); ctx.fill(); ctx.stroke()

  // Divisória interna (vortex finder visual)
  ctx.strokeStyle = 'rgba(91,200,245,0.55)'
  ctx.lineWidth   = 3
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(CX - OUTLET_W, CYL_TOP)
  ctx.lineTo(CX - OUTLET_W, CYL_TOP + (CYL_BOT - CYL_TOP) * 0.45)
  ctx.moveTo(CX + OUTLET_W, CYL_TOP)
  ctx.lineTo(CX + OUTLET_W, CYL_TOP + (CYL_BOT - CYL_TOP) * 0.45)
  ctx.stroke()
  ctx.setLineDash([])

  // Labels
  ctx.fillStyle = '#1e293b'
  ctx.font      = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('↑ Saída (Overflow)', CX, OUTLET_TOP + 14)
  ctx.textAlign = 'left'
  ctx.fillText('→ Entrada', CX + CYL_W + 8, INLET_Y - INLET_W - 5)
  ctx.textAlign = 'center'
  ctx.fillText('Coletor de Pó', CX, BOX_BOT - 8)
  ctx.fillStyle = 'rgba(91,200,245,0.9)'
  ctx.font      = '10px sans-serif'
  ctx.fillText('Vortex Finder', CX, CYL_TOP + 20)
}

// ── Componente React ──────────────────────────────────────────────────────────
const MAX_PARTICLES = 280

export default function CycloneSimulator2D({ isRunning = true }) {
  const canvasRef    = useRef(null)
  const poolRef      = useRef([])
  const lastTimeRef  = useRef(null)
  const spawnerRef   = useRef(null)
  const animFrameRef = useRef(null)
  const isRunningRef = useRef(isRunning)

  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    poolRef.current = []
    lastTimeRef.current = null

    // Spawner: nova partícula a cada 110ms
    spawnerRef.current = setInterval(() => {
      if (!isRunningRef.current) return
      if (poolRef.current.length < MAX_PARTICLES) {
        poolRef.current.push(makeParticle())
      }
    }, 110)

    function loop(timestamp) {
      const last = lastTimeRef.current
      const dt   = last ? Math.min((timestamp - last) / 1000, 1 / 30) : 1 / 60
      lastTimeRef.current = timestamp

      if (isRunningRef.current) {
        // Física
        for (const p of poolRef.current) stepParticle(p, dt)
        // Colisão entre partículas
        resolveCollisions(poolRef.current)
        // Remove partículas mortas
        poolRef.current = poolRef.current.filter(p => p.alive)
      }

      // Render
      ctx.clearRect(0, 0, W, H)
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#dbeafe')
      grad.addColorStop(1, '#f0f4f8')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      drawStructure(ctx)

      for (const p of poolRef.current) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'
        ctx.lineWidth   = 0.7
        ctx.stroke()
      }

      ctx.fillStyle = 'rgba(30,41,59,0.65)'
      ctx.font      = '11px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`Partículas: ${poolRef.current.length}`, 10, H - 10)

      animFrameRef.current = requestAnimationFrame(loop)
    }

    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      clearInterval(spawnerRef.current)
    }
  }, [])

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
