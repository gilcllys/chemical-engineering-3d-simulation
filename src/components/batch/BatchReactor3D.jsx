/**
 * BatchReactor3D.jsx
 * ──────────────────
 * Three.js 3D model + physics of a batch reactor.
 *
 * Reaction: A → B  (first-order)
 *   dCa/dt  = −k·Ca
 *   Ca(t)   = Ca0·exp(−k·t)
 *   X       = 1 − Ca/Ca0
 *   k(T)    = k0·exp(−Ea_R·(1/T − 1/T_ref))   Arrhenius
 *
 * Visual:
 *   · Cylindrical vessel + domed caps (glass / meshPhysicalMaterial)
 *   · Heating jacket (outer cylinder, orange, semi-transparent)
 *   · Agitator: shaft + 3-blade turbine impeller
 *   · 300 instanced particles: blue (#0077BB) → red (#CC3311) as X grows
 *   · Inlet / outlet nozzles
 *   · Html overlay (live X%, Ca, k values — DOM-mutated, zero re-renders)
 *
 * Props:
 *   isRunning  {boolean}
 *   params     { temperature, initialConc, agitatorSpeed, showJacket }
 */

import { useRef, useMemo, useEffect } from 'react'
import { useFrame }                   from '@react-three/fiber'
import { Html }                       from '@react-three/drei'
import * as THREE                     from 'three'

// ── Constants ─────────────────────────────────────────────────────────
const PARTICLE_COUNT = 300
const K0             = 0.1      // pre-exponential factor  (1/s)
const EA_R           = 5000     // Ea / R                  (K)
const T_REF          = 350      // reference temperature   (K)

// ── Paul Tol palette ──────────────────────────────────────────────────
const COL_A = new THREE.Color('#0077BB')   // reagent A – blue
const COL_B = new THREE.Color('#CC3311')   // product  B – red

/** Arrhenius rate constant */
function computeK(T) {
  return K0 * Math.exp(-EA_R * (1 / T - 1 / T_REF))
}

// ─────────────────────────────────────────────────────────────────────
export default function BatchReactor3D({ isRunning, params }) {
  const { temperature, initialConc, agitatorSpeed, showJacket } = params

  // ── Refs ──────────────────────────────────────────────────────────
  const agitatorRef  = useRef(null)
  const particlesRef = useRef(null)
  const timeRef      = useRef(0)
  const runRef       = useRef(isRunning)

  // HTML overlay – updated via direct DOM mutation (no state / re-renders)
  const domConv = useRef(null)
  const domCa   = useRef(null)
  const domK    = useRef(null)

  useEffect(() => { runRef.current = isRunning }, [isRunning])

  // ── Per-particle stable data (created once) ────────────────────────
  const particles = useMemo(() => {
    const arr = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr.push({
        r:     0.10 + Math.random() * 0.76,
        theta: Math.random() * Math.PI * 2,
        baseY: (Math.random() - 0.5) * 2.3,
        dir:   Math.random() < 0.5 ? 1 : -1,
        spd:   0.5 + Math.random() * 0.8,
        bx: 0, by: 0, bz: 0,
        noise: (Math.random() - 0.5) * 0.28,
      })
    }
    return arr
  }, [])

  // ── Reusable scratch objects (allocated once) ──────────────────────
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const _col  = useMemo(() => new THREE.Color(),    [])

  // ── Seed instance matrices on first mount ──────────────────────────
  useEffect(() => {
    const mesh = particlesRef.current
    if (!mesh) return
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]
      dummy.position.set(
        Math.cos(p.theta) * p.r,
        p.baseY,
        Math.sin(p.theta) * p.r,
      )
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, COL_A)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [particles, dummy])

  // ── Animation frame ────────────────────────────────────────────────
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)  // cap to 50 ms (tab-visibility guard)

    if (runRef.current) timeRef.current += dt

    const t  = timeRef.current
    const k  = computeK(temperature)
    const X  = Math.min(0.9999, 1 - Math.exp(-k * t))
    const Ca = initialConc * (1 - X)

    // ── HTML overlay (DOM mutation) ──────────────────────────────────
    if (domConv.current) domConv.current.textContent = `${(X * 100).toFixed(1)} %`
    if (domCa.current)   domCa.current.textContent   = `CA = ${Ca.toFixed(3)} mol/L`
    if (domK.current)    domK.current.textContent     = `k = ${k.toFixed(4)} s⁻¹`

    // ── Agitator rotation ────────────────────────────────────────────
    if (agitatorRef.current) {
      agitatorRef.current.rotation.y += dt * agitatorSpeed
    }

    // ── Particle positions + colours ─────────────────────────────────
    const mesh = particlesRef.current
    if (!mesh) return

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]

      if (runRef.current) {
        // Gentle orbital mixing driven by agitator speed
        p.theta += dt * agitatorSpeed * p.spd * p.dir * 0.38

        // Brownian perturbation (clamped)
        const B = 0.08
        p.bx = Math.max(-B, Math.min(B, p.bx + (Math.random() - 0.5) * 0.016))
        p.by = Math.max(-B, Math.min(B, p.by + (Math.random() - 0.5) * 0.016))
        p.bz = Math.max(-B, Math.min(B, p.bz + (Math.random() - 0.5) * 0.016))
      }

      dummy.position.set(
        Math.cos(p.theta) * p.r + p.bx,
        p.baseY            + p.by,
        Math.sin(p.theta) * p.r + p.bz,
      )
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Colour: lerp A→B using per-particle noisy conversion
      const lx = Math.max(0, Math.min(1, X + p.noise))
      _col.copy(COL_A).lerp(COL_B, lx)
      mesh.setColorAt(i, _col)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  // ─────────────────────────────────────────────────────────────────
  return (
    <group>

      {/* ══ Vessel cylinder (glass wall) ══════════════════════════════ */}
      <mesh castShadow>
        <cylinderGeometry args={[1, 1, 3, 48, 1, true]} />
        <meshPhysicalMaterial
          color="#88ccee"
          transparent opacity={0.22}
          roughness={0} metalness={0.08}
          transmission={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Top dome ─────────────────────────────────────────────────── */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          color="#88ccee"
          transparent opacity={0.22}
          roughness={0} metalness={0.08}
          transmission={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Bottom dome ──────────────────────────────────────────────── */}
      <mesh position={[0, -1.5, 0]} castShadow>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshPhysicalMaterial
          color="#88ccee"
          transparent opacity={0.22}
          roughness={0} metalness={0.08}
          transmission={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Metal flanges (top & bottom) ─────────────────────────────── */}
      <mesh position={[0,  1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.02, 0.046, 10, 48]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.15} />
      </mesh>
      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.02, 0.046, 10, 48]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.15} />
      </mesh>

      {/* ══ Heating / cooling jacket ═══════════════════════════════════ */}
      {showJacket && (
        <mesh>
          <cylinderGeometry args={[1.15, 1.15, 2.5, 32, 1, true]} />
          <meshStandardMaterial
            color="#EE7733"
            emissive="#cc5500" emissiveIntensity={0.18}
            transparent opacity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Jacket top / bottom rings */}
      {showJacket && (
        <>
          <mesh position={[0,  1.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.15, 0.03, 8, 40]} />
            <meshStandardMaterial color="#cc5500" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, -1.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.15, 0.03, 8, 40]} />
            <meshStandardMaterial color="#cc5500" metalness={0.6} roughness={0.4} />
          </mesh>
        </>
      )}

      {/* ══ Agitator (shaft + 3-blade turbine impeller) ════════════════ */}
      <group ref={agitatorRef}>

        {/* Shaft: from y=1.75 (through dome) down to y=−0.60 (~70 % depth) */}
        <mesh position={[0, 0.575, 0]}>
          <cylinderGeometry args={[0.040, 0.040, 2.35, 8]} />
          <meshStandardMaterial color="#475569" metalness={0.82} roughness={0.18} />
        </mesh>

        {/* Impeller hub */}
        <mesh position={[0, -0.62, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.12, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.22} />
        </mesh>

        {/* 3 turbine blades, 120° apart */}
        {[0, 1, 2].map(i => (
          <mesh
            key={i}
            position={[0, -0.62, 0]}
            rotation={[0, (i * Math.PI * 2) / 3, 0]}
          >
            <boxGeometry args={[0.72, 0.052, 0.14]} />
            <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.28} />
          </mesh>
        ))}
      </group>

      {/* ══ Inlet nozzle (upper-left) ══════════════════════════════════ */}
      <mesh position={[-1.22, 1.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.44, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[-1.44, 1.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.09, 0.022, 8, 24]} />
        <meshStandardMaterial color="#b0bec5" metalness={0.85} roughness={0.15} />
      </mesh>

      {/* ══ Outlet nozzle (lower-right) ════════════════════════════════ */}
      <mesh position={[1.22, -1.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.44, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[1.44, -1.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.09, 0.022, 8, 24]} />
        <meshStandardMaterial color="#b0bec5" metalness={0.85} roughness={0.15} />
      </mesh>

      {/* ══ Particles (instanced mesh) ════════════════════════════════ */}
      <instancedMesh
        ref={particlesRef}
        args={[undefined, undefined, PARTICLE_COUNT]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.04, 6, 6]} />
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.12} />
      </instancedMesh>

      {/* ══ HTML live-data overlay ════════════════════════════════════ */}
      <Html position={[1.82, 0.55, 0]} center>
        <div style={{
          background    : 'rgba(10,14,26,0.88)',
          color         : '#f8fafc',
          padding       : '11px 16px',
          borderRadius  : 9,
          fontSize      : 12,
          fontWeight    : 700,
          border        : '1px solid rgba(255,255,255,0.13)',
          minWidth      : 148,
          pointerEvents : 'none',
          lineHeight    : 1.75,
          boxShadow     : '0 4px 16px rgba(0,0,0,0.48)',
          userSelect    : 'none',
          whiteSpace    : 'nowrap',
        }}>
          <div style={{
            color: '#33BBEE', fontSize: 9.5, letterSpacing: 0.7,
            marginBottom: 5, textTransform: 'uppercase',
          }}>
            ⚗️ Reator Batelada
          </div>

          {/* Conversion – mutated directly by useFrame */}
          <div ref={domConv} style={{ fontSize: 20, color: '#EE7733' }}>
            0.0 %
          </div>
          <div style={{ color: '#94a3b8', fontSize: 9.5, marginBottom: 4 }}>
            Conversão X
          </div>

          {/* Concentration */}
          <div ref={domCa} style={{ color: '#f8fafc', fontSize: 11 }}>
            CA = {initialConc.toFixed(3)} mol/L
          </div>

          {/* Rate constant */}
          <div ref={domK} style={{ color: '#94a3b8', fontSize: 10 }}>
            k = 0.0000 s⁻¹
          </div>

          {/* Temperature (from prop – updates on re-render) */}
          <div style={{ color: '#94a3b8', fontSize: 10 }}>
            T = {temperature} K
          </div>
        </div>
      </Html>

    </group>
  )
}
