/**
 * PFR3D.jsx
 * ─────────
 * Three.js 3D visual component for the Plug Flow Reactor (PFR).
 *
 * Physics:
 *   Ca(z) = Ca0 · exp(-k · z / u)
 *   k(T)  = k0 · exp(-Ea_R · (1/T - 1/T_ref))   Ea_R=5000K, T_ref=350K, k0=0.15/s
 *   u     = Q / A_tube                            superficial velocity (m/s)
 *   τ     = L / u                                 residence time (s)
 *   X     = 1 - exp(-k·τ)                         exit conversion
 *
 * Visual strategy:
 *   · 10 ring-shaped cylinder segments coloured blue→red by Ca(z)/Ca0
 *   · 180 instanced spheres flow downward, colour updated per-frame via useFrame
 *   · 260 instanced catalyst pellets (gray spheres)
 *   · Orange helical heating coil (TubeGeometry + CatmullRomCurve3)
 *   · Semi-transparent outer shell + glass inner cylinder
 *   · Html labels for feed, product and live metrics
 *
 * Props:
 *   params     – from Leva controls (temperature, feedConc, flowRate, tubeLength, showCatalyst)
 *   isRunning  – boolean
 */

import { useRef, useMemo, useEffect } from 'react'
import { useFrame }                   from '@react-three/fiber'
import { Html }                       from '@react-three/drei'
import * as THREE                     from 'three'

// ── PFR Physics constants ───────────────────────────────────────────────────
const K0     = 0.15                    // s⁻¹  pre-exponential factor
const EA_R   = 5000                    // K    activation energy / R
const T_REF  = 350                     // K    reference temperature
// A_TUBE chosen so that default params (Q=1 L/s, L=5 m) yield τ=8 s, X≈70 %
// R_tube ≈ 0.0226 m  →  A = π × r² ≈ 0.0016 m²  (matches PFR2D fixed physics)
const A_TUBE = 0.0016                  // m²

function calcK(T) {
  return K0 * Math.exp(-EA_R * (1 / T - 1 / T_REF))
}

// ── Paul Tol palette ────────────────────────────────────────────────────────
const COLOR_FEED    = new THREE.Color('#0077BB')  // blue  – reagente A (entrada)
const COLOR_PRODUCT = new THREE.Color('#CC3311')  // red   – produto  B (saída)
const _col          = new THREE.Color()           // reusable mutable buffer (avoid GC)

/** Lerp between feed-blue and product-red by frac ∈ [0,1]. */
function gradColor(frac) {
  return _col.lerpColors(COLOR_FEED, COLOR_PRODUCT, Math.max(0, Math.min(1, frac)))
}

// ── Scene constants ─────────────────────────────────────────────────────────
const N_PARTICLES = 180
const N_BANDS     = 10
const N_CATALYST  = 260

// ── Module-level stable catalyst positions (generated once, never change) ───
const CATALYST_POS = Array.from({ length: N_CATALYST }, () => {
  const ang = Math.random() * Math.PI * 2
  const r   = Math.random() * 0.48
  return {
    x: r * Math.cos(ang),
    y: (Math.random() - 0.5) * 4.8,
    z: r * Math.sin(ang),
  }
})

/** Build fresh particle array (called on mount / reset via key prop). */
function initParticles() {
  return Array.from({ length: N_PARTICLES }, (_, i) => {
    const ang = Math.random() * Math.PI * 2
    const r   = Math.random() * 0.44
    return {
      y:        2.5 - (i / N_PARTICLES) * 5,  // staggered initial y
      x:        r * Math.cos(ang),
      z:        r * Math.sin(ang),
      progress: i / N_PARTICLES,
    }
  })
}

// ── Component ───────────────────────────────────────────────────────────────
export default function PFR3D({ params, isRunning }) {
  const {
    temperature  = 350,
    feedConc     = 2.0,
    flowRate     = 1.0,
    tubeLength   = 5.0,
    showCatalyst = true,
  } = params

  // ── Derived physics ───────────────────────────────────────────────────────
  const k      = calcK(temperature)
  const Q_m3   = flowRate / 1000           // L/s → m³/s
  const u      = Q_m3 / A_TUBE             // m/s  superficial velocity
  const tau    = tubeLength / u            // s    residence time
  const Xexit  = 1 - Math.exp(-k * tau)
  const Caexit = feedConc * Math.exp(-k * tau)

  // Visual speed: scales with Q so higher flow is visually faster
  const flowSpeed = Math.min(2.8, 0.7 + flowRate * 0.42)

  // ── Refs (mutable state that must not trigger re-renders) ─────────────────
  const pRef  = useRef(initParticles())   // particle data array
  const pMesh = useRef(null)              // InstancedMesh – particles
  const cMesh = useRef(null)              // InstancedMesh – catalyst
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // ── Catalyst: set up instance matrices once (or when showCatalyst flips) ──
  useEffect(() => {
    if (!showCatalyst || !cMesh.current) return
    const d = new THREE.Object3D()
    CATALYST_POS.forEach((p, i) => {
      d.position.set(p.x, p.y, p.z)
      d.updateMatrix()
      cMesh.current.setMatrixAt(i, d.matrix)
    })
    cMesh.current.instanceMatrix.needsUpdate = true
  }, [showCatalyst])

  // ── Particles: initialise positions + blue colour on first mount ──────────
  useEffect(() => {
    if (!pMesh.current) return
    pRef.current.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z)
      dummy.updateMatrix()
      pMesh.current.setMatrixAt(i, dummy.matrix)
      pMesh.current.setColorAt(i, COLOR_FEED)
    })
    pMesh.current.instanceMatrix.needsUpdate = true
    if (pMesh.current.instanceColor) pMesh.current.instanceColor.needsUpdate = true
  }, [dummy])

  // ── Gradient band colours (recomputed whenever physics change) ────────────
  const bandColors = useMemo(
    () =>
      Array.from({ length: N_BANDS }, (_, i) => {
        const z  = ((i + 0.5) / N_BANDS) * tubeLength
        const Ca = feedConc * Math.exp(-k * z / u)
        const t  = Math.max(0, Math.min(1, 1 - Ca / feedConc))
        // Return a fresh Color (not _col, which is shared)
        return new THREE.Color().lerpColors(COLOR_FEED, COLOR_PRODUCT, t)
      }),
    [k, feedConc, u, tubeLength]
  )

  // ── Heating coil geometry (stable – no deps) ──────────────────────────────
  const helixCurve = useMemo(() => {
    const pts   = []
    const turns = 8
    for (let i = 0; i <= turns * 64; i++) {
      const t = i / (turns * 64)
      const a = t * turns * Math.PI * 2
      pts.push(new THREE.Vector3(
        0.53 * Math.cos(a),
        2.28 - t * 4.56,
        0.53 * Math.sin(a),
      ))
    }
    return new THREE.CatmullRomCurve3(pts)
  }, [])

  // ── Animation frame ───────────────────────────────────────────────────────
  const bandH = 5 / N_BANDS

  useFrame((_, dt) => {
    if (!isRunning || !pMesh.current) return

    const ps = pRef.current
    for (let i = 0; i < N_PARTICLES; i++) {
      const p = ps[i]

      // Move downward at visual flow speed
      p.y -= dt * flowSpeed
      if (p.y < -2.5) {
        p.y       = 2.5
        p.progress = 0
      }
      p.progress = (2.5 - p.y) / 5.0

      // Axial concentration → colour
      const z_pos = p.progress * tubeLength
      const Ca    = feedConc * Math.exp(-k * z_pos / u)
      const frac  = 1 - Ca / feedConc

      const col = gradColor(frac)

      dummy.position.set(p.x, p.y, p.z)
      dummy.updateMatrix()
      pMesh.current.setMatrixAt(i, dummy.matrix)
      pMesh.current.setColorAt(i, col)
    }

    pMesh.current.instanceMatrix.needsUpdate = true
    if (pMesh.current.instanceColor) pMesh.current.instanceColor.needsUpdate = true
  })

  // ── Shared styles ─────────────────────────────────────────────────────────
  const pillStyle = (bg) => ({
    background:   bg,
    color:        '#fff',
    padding:      '3px 10px',
    borderRadius: 6,
    fontSize:     11,
    fontWeight:   700,
    whiteSpace:   'nowrap',
    boxShadow:    '0 2px 8px rgba(0,0,0,0.30)',
    pointerEvents: 'none',
    userSelect:   'none',
  })

  const overlayStyle = {
    background:    'rgba(255,255,255,0.96)',
    border:        '1px solid #cbd5e1',
    borderRadius:  10,
    padding:       '10px 14px',
    fontSize:      11,
    fontFamily:    'monospace',
    boxShadow:     '0 4px 20px rgba(0,0,0,0.18)',
    minWidth:      174,
    lineHeight:    1.8,
    pointerEvents: 'none',
    userSelect:    'none',
  }

  const row = (label, value, unit, color) => (
    <div key={label}>
      <span style={{ color: '#64748b' }}>{label}</span>
      {' = '}
      <b style={{ color }}>{value}</b>
      <span style={{ color: '#94a3b8', fontSize: 10 }}> {unit}</span>
    </div>
  )

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <group>

      {/* ── Outer metallic shell (semi-transparent to reveal interior) ── */}
      <mesh>
        <cylinderGeometry args={[0.62, 0.62, 5.10, 32, 1, true]} />
        <meshStandardMaterial
          color="#5a6475"
          metalness={0.85}
          roughness={0.18}
          transparent
          opacity={0.52}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Inner glass tube ─────────────────────────────────────────── */}
      <mesh renderOrder={2}>
        <cylinderGeometry args={[0.576, 0.576, 5.00, 32, 1, true]} />
        <meshPhysicalMaterial
          color="#aad4ee"
          transparent
          opacity={0.12}
          roughness={0}
          metalness={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Axial gradient band rings (blue → red, top → bottom) ─────── */}
      {bandColors.map((col, i) => (
        <mesh
          key={i}
          position={[0, 2.5 - (i + 0.5) * bandH, 0]}
          renderOrder={1}
        >
          <cylinderGeometry args={[0.553, 0.553, bandH - 0.012, 24, 1, false]} />
          <meshStandardMaterial color={col} transparent opacity={0.88} />
        </mesh>
      ))}

      {/* ── Catalyst packing (grey pellets) ──────────────────────────── */}
      {showCatalyst && (
        <instancedMesh
          ref={cMesh}
          args={[undefined, undefined, N_CATALYST]}
          frustumCulled={false}
        >
          <sphereGeometry args={[0.04, 5, 5]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.88} metalness={0.08} />
        </instancedMesh>
      )}

      {/* ── Flowing particles ─────────────────────────────────────────── */}
      <instancedMesh
        ref={pMesh}
        args={[undefined, undefined, N_PARTICLES]}
        frustumCulled={false}
        renderOrder={3}
      >
        <sphereGeometry args={[0.034, 7, 7]} />
        <meshStandardMaterial vertexColors roughness={0.42} />
      </instancedMesh>

      {/* ── Top cap ───────────────────────────────────────────────────── */}
      <mesh position={[0, 2.578, 0]}>
        <cylinderGeometry args={[0.62, 0.62, 0.1, 32]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>

      {/* ── Inlet nozzle (horizontal side pipe at top) ────────────────── */}
      <mesh position={[0.52, 2.90, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.115, 0.115, 0.64, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>
      {/* Nozzle flange */}
      <mesh position={[0.89, 2.90, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.04, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>

      {/* ── Bottom cap ────────────────────────────────────────────────── */}
      <mesh position={[0, -2.578, 0]}>
        <cylinderGeometry args={[0.62, 0.62, 0.1, 32]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>

      {/* ── Outlet nozzle (horizontal side pipe at bottom) ────────────── */}
      <mesh position={[0.52, -2.90, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.115, 0.115, 0.64, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>
      {/* Nozzle flange */}
      <mesh position={[0.89, -2.90, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.04, 16]} />
        <meshStandardMaterial color="#374151" metalness={0.88} roughness={0.14} />
      </mesh>

      {/* ── Orange heating coil ──────────────────────────────────────── */}
      <mesh>
        <tubeGeometry args={[helixCurve, 320, 0.022, 8, false]} />
        <meshStandardMaterial
          color="#EE7733"
          metalness={0.52}
          roughness={0.38}
          emissive="#bb3300"
          emissiveIntensity={0.14}
        />
      </mesh>

      {/* ── Feed label ───────────────────────────────────────────────── */}
      <Html center position={[1.05, 3.02, 0]} distanceFactor={7}>
        <div style={pillStyle('#0077BB')}>
          ↓ Feed (C<sub>A0</sub>&nbsp;=&nbsp;{feedConc.toFixed(1)}&nbsp;mol/L)
        </div>
      </Html>

      {/* ── Product label ─────────────────────────────────────────────── */}
      <Html center position={[1.05, -3.02, 0]} distanceFactor={7}>
        <div style={pillStyle('#CC3311')}>
          ↑ Produto (C<sub>A</sub>&nbsp;=&nbsp;{Caexit.toFixed(2)}&nbsp;mol/L)
        </div>
      </Html>

      {/* ── Live metrics overlay (left side) ─────────────────────────── */}
      <Html center position={[-1.65, 0, 0]} distanceFactor={7}>
        <div style={overlayStyle}>
          <div style={{
            fontWeight: 800, fontSize: 12, color: '#1e293b',
            marginBottom: 6, borderBottom: '1px solid #e2e8f0', paddingBottom: 4,
          }}>
            📊 PFR — Perfil Axial
          </div>
          {row('k(T)',    k.toFixed(4),          's⁻¹',   '#0077BB')}
          {row('u',      u.toFixed(3),           'm/s',   '#009988')}
          {row('τ',      tau.toFixed(2),          's',     '#EE7733')}
          {row('X_saída', (Xexit * 100).toFixed(1), '%',    '#CC3311')}
          {row('CA_saída', Caexit.toFixed(3),      'mol/L', '#CC3311')}
        </div>
      </Html>

    </group>
  )
}
