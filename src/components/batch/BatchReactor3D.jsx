/**
 * BatchReactor3D.jsx
 * Reator Batelada 3D — Líquido com superfície animada (height-field vórtice)
 *
 * Abordagem visual inspirada em webgl_gpgpu_water (Three.js):
 *   · Volume líquido: CylinderGeometry preenchendo o interior do vaso
 *   · Superfície: CircleGeometry polar com vértices deslocados por height field
 *     simulando vórtice centrífugo + ondas (equação de onda discreta 2D)
 *   · Cor do líquido interpolada A→B conforme conversão X
 *   · Bolhas (instancedMesh pequeno) subindo pela corrente do agitador
 */

import { useRef, useMemo, useEffect } from 'react'
import { useFrame }                   from '@react-three/fiber'
import { Html }                       from '@react-three/drei'
import * as THREE                     from 'three'

// ── Constantes de reação ──────────────────────────────────────────────────────
const K0    = 0.1
const EA_R  = 5000
const T_REF = 350
function computeK(T) { return K0 * Math.exp(-EA_R * (1/T - 1/T_REF)) }

// ── Geometria do líquido ──────────────────────────────────────────────────────
const LIQUID_R    = 0.87   // raio do líquido (ligeiramente menor que o vaso)
const LIQUID_BOT  = -1.32  // fundo do líquido
const LIQUID_TOP  = -0.05  // superfície livre em repouso (60% do vaso)
const LIQUID_H    = LIQUID_TOP - LIQUID_BOT

// ── Surface height field ──────────────────────────────────────────────────────
const SURF_SEGS   = 48     // segmentos radiais da superfície
const SURF_RINGS  = 24     // anéis radiais
// Total de vértices na malha polar: (SURF_RINGS+1) * (SURF_SEGS+1) + 1 centro
// Usamos CircleGeometry com segmentos suficientes

// ── Bolhas ────────────────────────────────────────────────────────────────────
const BUBBLE_COUNT = 60
const BUBBLE_R     = 0.022

// ── Paleta Paul Tol ──────────────────────────────────────────────────────────
const COL_A = new THREE.Color('#0077BB')
const COL_B = new THREE.Color('#CC3311')

// ─────────────────────────────────────────────────────────────────────────────
export default function BatchReactor3D({ isRunning, params }) {
  const { temperature, initialConc, agitatorSpeed, showJacket } = params

  // ── Refs ────────────────────────────────────────────────────────────────────
  const agitatorRef  = useRef(null)
  const liquidRef    = useRef(null)   // volume mesh
  const surfaceRef   = useRef(null)   // surface mesh
  const bubblesRef   = useRef(null)
  const timeRef      = useRef(0)
  const runRef       = useRef(isRunning)
  const agitAngle    = useRef(0)

  // DOM overlay refs
  const domConv = useRef(null)
  const domCa   = useRef(null)
  const domK    = useRef(null)

  useEffect(() => { runRef.current = isRunning }, [isRunning])

  // ── Height field: armazena alturas dos vértices da superfície ────────────────
  // CircleGeometry(r, segs) tem: 1 centro + segs anéis de segs vértices
  const hCurrent = useRef(null)   // h[i] = deslocamento Y atual
  const hPrev    = useRef(null)   // h[i] = passo anterior (equação de onda)
  const hVel     = useRef(null)   // velocidade da superfície

  // ── Geometria da superfície polar customizada ────────────────────────────────
  const surfaceGeo = useMemo(() => {
    // Construímos uma malha polar para ter controlo total dos vértices
    const rings  = SURF_RINGS
    const segs   = SURF_SEGS
    const vCount = 1 + rings * segs  // centro + anéis
    const positions = new Float32Array(vCount * 3)
    const normals   = new Float32Array(vCount * 3)
    const uvs       = new Float32Array(vCount * 2)
    const indices   = []

    // Vértice central
    positions[0] = 0; positions[1] = 0; positions[2] = 0
    normals[1] = 1; uvs[0] = 0.5; uvs[1] = 0.5

    for (let ring = 0; ring < rings; ring++) {
      const r = LIQUID_R * (ring + 1) / rings
      for (let seg = 0; seg < segs; seg++) {
        const angle = (seg / segs) * Math.PI * 2
        const idx   = 1 + ring * segs + seg
        positions[idx*3]   = Math.cos(angle) * r
        positions[idx*3+1] = 0
        positions[idx*3+2] = Math.sin(angle) * r
        normals[idx*3+1]   = 1
        uvs[idx*2]   = 0.5 + Math.cos(angle) * 0.5 * (ring+1)/rings
        uvs[idx*2+1] = 0.5 + Math.sin(angle) * 0.5 * (ring+1)/rings
      }
    }

    // Triângulos: anel 0 conectado ao centro
    for (let seg = 0; seg < segs; seg++) {
      const a = 0
      const b = 1 + seg
      const c = 1 + (seg + 1) % segs
      indices.push(a, b, c)
    }
    // Triângulos entre anéis
    for (let ring = 0; ring < rings - 1; ring++) {
      for (let seg = 0; seg < segs; seg++) {
        const a = 1 + ring * segs + seg
        const b = 1 + ring * segs + (seg + 1) % segs
        const c = 1 + (ring + 1) * segs + seg
        const d = 1 + (ring + 1) * segs + (seg + 1) % segs
        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3))
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2))
    geo.setIndex(indices)
    return geo
  }, [])

  const vCount = useMemo(() => 1 + SURF_RINGS * SURF_SEGS, [])

  // Inicializa height fields
  useEffect(() => {
    hCurrent.current = new Float32Array(vCount)
    hPrev.current    = new Float32Array(vCount)
    hVel.current     = new Float32Array(vCount)
  }, [vCount])

  // ── Bolhas: dados estáveis ────────────────────────────────────────────────────
  const bubbles = useMemo(() => Array.from({ length: BUBBLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2
    const r     = Math.random() * (LIQUID_R * 0.75)
    return {
      x:     Math.cos(angle) * r,
      z:     Math.sin(angle) * r,
      y:     LIQUID_BOT + Math.random() * LIQUID_H,
      speed: 0.18 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
    }
  }), [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const _col  = useMemo(() => new THREE.Color(), [])

  // ── useFrame: física + animação ───────────────────────────────────────────────
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    if (runRef.current) timeRef.current += dt

    const t  = timeRef.current
    const k  = computeK(temperature)
    const X  = Math.min(0.9999, 1 - Math.exp(-k * t))
    const Ca = initialConc * (1 - X)

    // DOM overlay
    if (domConv.current) domConv.current.textContent = `${(X * 100).toFixed(1)} %`
    if (domCa.current)   domCa.current.textContent   = `CA = ${Ca.toFixed(3)} mol/L`
    if (domK.current)    domK.current.textContent     = `k = ${k.toFixed(4)} s⁻¹`

    // Agitador
    if (agitatorRef.current && runRef.current) {
      agitatorRef.current.rotation.y += dt * agitatorSpeed
      agitAngle.current += dt * agitatorSpeed
    }

    // ── Cor do líquido (reação A→B) ────────────────────────────────────────────
    const liqColor = new THREE.Color().copy(COL_A).lerp(COL_B, X)
    if (liquidRef.current) {
      liquidRef.current.material.color.copy(liqColor)
      liquidRef.current.material.emissive.copy(liqColor)
      liquidRef.current.material.emissiveIntensity = 0.18
    }
    if (surfaceRef.current) {
      surfaceRef.current.material.color.copy(liqColor)
      surfaceRef.current.material.emissive.copy(liqColor)
      surfaceRef.current.material.emissiveIntensity = 0.22
    }

    if (!runRef.current) return

    // ── Equação de onda + vórtice (height field) ───────────────────────────────
    const hC  = hCurrent.current
    const hP  = hPrev.current
    const hV  = hVel.current
    if (!hC || !surfaceRef.current) return

    const pos  = surfaceRef.current.geometry.attributes.position
    const norm = surfaceRef.current.geometry.attributes.normal
    const c2   = 0.28  // velocidade de propagação²

    // Forçamento centrífugo do agitador na superfície
    const agitStr = agitatorSpeed * 0.055

    for (let i = 0; i < vCount; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.sqrt(x*x + z*z)
      const θ = Math.atan2(z, x)

      // Vórtice: depressão parabólica no centro + ondas espirais
      const vortex   = agitStr * r * r * 0.8              // depressão centrífuga
      const spiral   = agitStr * Math.sin(θ - agitAngle.current * 1.4 + r * 6) * r * 0.5
      const targetH  = -vortex + spiral

      // Força restauradora em direção ao alvo (evita explosão)
      hV[i] += (targetH - hC[i]) * 4.5 * dt

      // Propagação de onda (vizinhos — simplificado para malha polar)
      // usamos velocidade acumulada ao longo do tempo
      hV[i] *= 0.88  // amortecimento

      const newH = hC[i] + hV[i] * dt
      hP[i] = hC[i]
      hC[i] = newH

      pos.setY(i, newH)
    }

    // Recalcula normais
    pos.needsUpdate  = true
    surfaceRef.current.geometry.computeVertexNormals()

    // ── Bolhas ─────────────────────────────────────────────────────────────────
    const mesh = bubblesRef.current
    if (!mesh) return

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const b = bubbles[i]
      // Sobe com a corrente do agitador
      b.y += b.speed * dt * (0.4 + agitatorSpeed * 0.6)
      // Oscilação lateral suave
      const wobble = Math.sin(t * 2.1 + b.phase) * 0.04
      const wx     = Math.cos(b.phase + t) * wobble
      const wz     = Math.sin(b.phase + t) * wobble

      // Reseta quando sai da superfície
      if (b.y > LIQUID_TOP + 0.05) {
        b.y = LIQUID_BOT + Math.random() * 0.2
        const angle = Math.random() * Math.PI * 2
        const r2    = Math.random() * LIQUID_R * 0.72
        b.x = Math.cos(angle) * r2
        b.z = Math.sin(angle) * r2
      }

      // Esconde bolhas acima da superfície livre
      const scale = b.y < LIQUID_TOP - 0.05 ? 1 : 0

      dummy.position.set(b.x + wx, b.y, b.z + wz)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Cor da bolha = levemente mais clara que o líquido (reflexo)
      _col.copy(liqColor).lerp(new THREE.Color('#ffffff'), 0.35)
      mesh.setColorAt(i, _col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <group>

      {/* ══ Vaso — parede de vidro ══════════════════════════════════════════════ */}
      <mesh castShadow>
        <cylinderGeometry args={[1, 1, 3, 56, 1, true]} />
        <meshPhysicalMaterial color="#88ccee" transparent opacity={0.18}
          roughness={0} metalness={0.08} transmission={0.75} side={THREE.DoubleSide} />
      </mesh>

      {/* Tampa superior */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI*2, 0, Math.PI/2]} />
        <meshPhysicalMaterial color="#88ccee" transparent opacity={0.18}
          roughness={0} metalness={0.08} transmission={0.75} side={THREE.DoubleSide} />
      </mesh>

      {/* Tampa inferior */}
      <mesh position={[0, -1.5, 0]}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI*2, Math.PI/2, Math.PI/2]} />
        <meshPhysicalMaterial color="#88ccee" transparent opacity={0.18}
          roughness={0} metalness={0.08} transmission={0.75} side={THREE.DoubleSide} />
      </mesh>

      {/* Flanges */}
      {[1.5, -1.5].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[-Math.PI/2, 0, 0]}>
          <torusGeometry args={[1.02, 0.046, 10, 48]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.15} />
        </mesh>
      ))}

      {/* ══ Jaqueta de aquecimento ══════════════════════════════════════════════ */}
      {showJacket && (
        <>
          <mesh>
            <cylinderGeometry args={[1.15, 1.15, 2.5, 32, 1, true]} />
            <meshStandardMaterial color="#EE7733" emissive="#cc5500" emissiveIntensity={0.18}
              transparent opacity={0.32} side={THREE.DoubleSide} />
          </mesh>
          {[1.25, -1.25].map((y, i) => (
            <mesh key={i} position={[0, y, 0]} rotation={[-Math.PI/2, 0, 0]}>
              <torusGeometry args={[1.15, 0.03, 8, 40]} />
              <meshStandardMaterial color="#cc5500" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </>
      )}

      {/* ══ Agitador (eixo + turbina 3 pás) ═══════════════════════════════════ */}
      <group ref={agitatorRef}>
        <mesh position={[0, 0.575, 0]}>
          <cylinderGeometry args={[0.040, 0.040, 2.35, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.82} roughness={0.18} />
        </mesh>
        <mesh position={[0, -0.62, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.12, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.22} />
        </mesh>
        {[0,1,2].map(i => (
          <mesh key={i} position={[0, -0.62, 0]} rotation={[0, (i * Math.PI*2)/3, 0]}>
            <boxGeometry args={[0.72, 0.052, 0.14]} />
            <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.28} />
          </mesh>
        ))}
      </group>

      {/* ══ Bicos de entrada/saída ══════════════════════════════════════════════ */}
      <mesh position={[-1.22, 1.05, 0]} rotation={[0,0,Math.PI/2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.44, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[-1.44, 1.05, 0]} rotation={[0,0,Math.PI/2]}>
        <torusGeometry args={[0.09, 0.022, 8, 24]} />
        <meshStandardMaterial color="#b0bec5" metalness={0.85} roughness={0.15} />
      </mesh>
      <mesh position={[1.22, -1.05, 0]} rotation={[0,0,Math.PI/2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.44, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[1.44, -1.05, 0]} rotation={[0,0,Math.PI/2]}>
        <torusGeometry args={[0.09, 0.022, 8, 24]} />
        <meshStandardMaterial color="#b0bec5" metalness={0.85} roughness={0.15} />
      </mesh>

      {/* ══ VOLUME DO LÍQUIDO ══════════════════════════════════════════════════ */}
      {/* Corpo principal do líquido (cilindro sólido) */}
      <mesh ref={liquidRef} position={[0, LIQUID_BOT + LIQUID_H/2, 0]}>
        <cylinderGeometry args={[LIQUID_R, LIQUID_R, LIQUID_H, 56, 1]} />
        <meshStandardMaterial
          color={COL_A} transparent opacity={0.82}
          roughness={0.12} metalness={0.04}
          emissive={COL_A} emissiveIntensity={0.18}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Tampa inferior do líquido (fecha o cilindro) */}
      <mesh position={[0, LIQUID_BOT, 0]} rotation={[Math.PI/2, 0, 0]}>
        <circleGeometry args={[LIQUID_R, 56]} />
        <meshStandardMaterial color={COL_A} transparent opacity={0.75}
          roughness={0.15} metalness={0.04} emissive={COL_A} emissiveIntensity={0.15} />
      </mesh>

      {/* ══ SUPERFÍCIE DO LÍQUIDO (height field animada) ═════════════════════ */}
      <mesh ref={surfaceRef} position={[0, LIQUID_TOP, 0]} geometry={surfaceGeo}>
        <meshStandardMaterial
          color={COL_A} transparent opacity={0.92}
          roughness={0.08} metalness={0.06}
          emissive={COL_A} emissiveIntensity={0.25}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ══ BOLHAS ════════════════════════════════════════════════════════════ */}
      <instancedMesh ref={bubblesRef} args={[undefined, undefined, BUBBLE_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[BUBBLE_R, 6, 6]} />
        <meshStandardMaterial vertexColors transparent opacity={0.65}
          roughness={0.1} metalness={0.05} />
      </instancedMesh>

      {/* ══ HTML overlay ══════════════════════════════════════════════════════ */}
      <Html position={[1.82, 0.55, 0]} center>
        <div style={{
          background:'rgba(10,14,26,0.88)', color:'#f8fafc',
          padding:'11px 16px', borderRadius:9, fontSize:12, fontWeight:700,
          border:'1px solid rgba(255,255,255,0.13)', minWidth:148,
          pointerEvents:'none', lineHeight:1.75,
          boxShadow:'0 4px 16px rgba(0,0,0,0.48)', userSelect:'none', whiteSpace:'nowrap',
        }}>
          <div style={{color:'#33BBEE',fontSize:9.5,letterSpacing:0.7,marginBottom:5,textTransform:'uppercase'}}>
            ⚗️ Reator Batelada
          </div>
          <div style={{fontSize:22,fontWeight:800,color:'#EE7733',lineHeight:1.2}}>
            <span ref={domConv}>0.0 %</span>
          </div>
          <div style={{fontSize:10,color:'rgba(248,250,252,0.6)',marginBottom:4}}>Conversão X</div>
          <div ref={domCa}  style={{color:'#f8fafc',fontSize:11}}>CA = {initialConc.toFixed(3)} mol/L</div>
          <div ref={domK}   style={{color:'rgba(248,250,252,0.55)',fontSize:10}}>k = 0.0000 s⁻¹</div>
          <div style={{color:'rgba(248,250,252,0.55)',fontSize:10}}>T = {temperature} K</div>
        </div>
      </Html>
    </group>
  )
}
