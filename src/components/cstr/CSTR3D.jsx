/**
 * CSTR3D.jsx
 * ──────────
 * Three.js / R3F 3-D model of a Continuous Stirred Tank Reactor.
 *
 * Physics (steady-state CSTR):
 *   k(T)  = k₀ · exp( −Eₐ/R · (1/T − 1/T_ref) )
 *   τ     = V / Q
 *   X_ss  = k·τ / (1 + k·τ)
 *   Cₐ    = Cₐ₀ · (1 − X)
 *
 * Transient: X approaches X_ss with a smooth exponential lag.
 * Interior is well-mixed → all particles share the same colour = lerp(#0077BB, #CC3311, X).
 */

import { useRef, useMemo, useEffect } from 'react'
import { useFrame }                   from '@react-three/fiber'
import { Html }                        from '@react-three/drei'
import * as THREE                      from 'three'

// ── Constants ────────────────────────────────────────────────────────────────
const N_PARTICLES = 240
const VESSEL_R    = 1.2          // cylinder radius (m)
const VESSEL_H    = 2.4          // cylinder height (m)
const K0          = 0.12         // pre-exponential (s⁻¹)
const EA_R        = 5000         // Eₐ/R (K)
const T_REF       = 350          // reference temperature (K)

// ── Paul Tol colours ─────────────────────────────────────────────────────────
const COL_A   = new THREE.Color('#0077BB')  // reagent A  – blue
const COL_B   = new THREE.Color('#CC3311')  // product B  – red
const _colTmp = new THREE.Color()

/** Mutates the shared _colTmp buffer – call only once per frame */
function mixColor(X) {
  _colTmp.copy(COL_A).lerp(COL_B, Math.max(0, Math.min(1, X)))
  return _colTmp
}

// ── Overlay panel (rendered as HTML inside the Three.js scene) ────────────────
function StatsOverlay({ tauRef, xRef, caRef, kRef }) {
  const row = (label, ref, unit, col) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: '#64748b', letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: col, fontSize: 13 }}>
        <span ref={ref}>—</span>
        <span style={{ fontSize: 9, color: '#94a3b8', marginLeft: 2 }}>{unit}</span>
      </span>
    </div>
  )

  return (
    <div style={{
      background    : 'rgba(255,255,255,0.93)',
      border        : '1px solid #cbd5e1',
      borderRadius  : 10,
      padding       : '10px 13px',
      width         : 190,
      backdropFilter: 'blur(8px)',
      boxShadow     : '0 4px 16px rgba(30,41,59,0.13)',
      pointerEvents : 'none',
      userSelect    : 'none',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', marginBottom: 8, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        📊 Estado Atual
      </div>
      {row('τ  (tempo residência)', tauRef, 's',     '#7c3aed')}
      {row('X  (conversão)',        xRef,  '%',      '#059669')}
      {row('Cₐ (concentração saída)',caRef, 'mol/L', '#CC3311')}
      {row('k  (constante cinética)',kRef,  's⁻¹',   '#0077BB')}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CSTR3D({
  temperature = 350,
  feedConc    = 2.0,
  flowRate    = 1.0,
  volume      = 10,
  agitSpeed   = 2.0,
  showJacket  = true,
  isRunning   = true,
}) {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const agitRef   = useRef()
  const meshRef   = useRef()
  const liquidRef = useRef()
  const xState    = useRef(0)
  const dummy     = useMemo(() => new THREE.Object3D(), [])

  // DOM refs for the HTML overlay (updated directly from useFrame – no re-renders)
  const oTau = useRef(null)
  const oX   = useRef(null)
  const oCa  = useRef(null)
  const oK   = useRef(null)

  // ── Particle state (stable Float32Arrays – mutated in useFrame) ──────────
  const positions = useMemo(() => {
    const arr = new Float32Array(N_PARTICLES * 3)
    for (let i = 0; i < N_PARTICLES; i++) {
      const r     = (0.15 + Math.random() * 0.78) * (VESSEL_R - 0.12)
      const theta = Math.random() * Math.PI * 2
      const y     = (Math.random() - 0.5) * (VESSEL_H - 0.35)
      arr[i * 3]     = r * Math.cos(theta)
      arr[i * 3 + 1] = y
      arr[i * 3 + 2] = r * Math.sin(theta)
    }
    return arr
  }, [])

  const velocities = useMemo(() => new Float32Array(N_PARTICLES * 3), [])

  // ── Initialise InstancedMesh after mount ──────────────────────────────────
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const initCol = new THREE.Color('#0077BB')
    for (let i = 0; i < N_PARTICLES; i++) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, initCol)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [dummy, positions])

  // ── useFrame ─────────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)

    // CSTR steady-state physics
    const k    = K0 * Math.exp(-EA_R * (1 / temperature - 1 / T_REF))
    const tau  = volume / flowRate
    const X_ss = (k * tau) / (1 + k * tau)

    if (isRunning) {
      // Smooth exponential approach (time constant ≈ 2 s)
      xState.current += (X_ss - xState.current) * (1 - Math.exp(-dt * 0.5))
    }

    const X  = Math.max(0, Math.min(1, xState.current))
    const Ca = feedConc * (1 - X)

    // Update overlay DOM elements directly (no React re-render cost)
    if (oTau.current) oTau.current.textContent = tau.toFixed(1)
    if (oX.current)   oX.current.textContent   = (X * 100).toFixed(1)
    if (oCa.current)  oCa.current.textContent  = Ca.toFixed(3)
    if (oK.current)   oK.current.textContent   = k.toFixed(4)

    // Uniform particle colour (well-mixed CSTR)
    const col = mixColor(X)

    // Particles ─────────────────────────────────────────────────────────────
    if (meshRef.current) {
      if (isRunning) {
        for (let i = 0; i < N_PARTICLES; i++) {
          const i3 = i * 3

          // Vortex: tangential impulse around Y axis
          const px   = positions[i3]
          const pz   = positions[i3 + 2]
          const dist = Math.sqrt(px * px + pz * pz) + 0.001
          velocities[i3]     += (-pz / dist) * agitSpeed * 0.42 * dt
          velocities[i3 + 2] += ( px / dist) * agitSpeed * 0.42 * dt

          // Brownian noise
          velocities[i3]     += (Math.random() - 0.5) * 1.5 * dt
          velocities[i3 + 1] += (Math.random() - 0.5) * 1.5 * dt
          velocities[i3 + 2] += (Math.random() - 0.5) * 1.5 * dt

          // Damping
          const d = Math.exp(-3.0 * dt)
          velocities[i3]     *= d
          velocities[i3 + 1] *= d
          velocities[i3 + 2] *= d

          // Integrate
          positions[i3]     += velocities[i3]     * dt
          positions[i3 + 1] += velocities[i3 + 1] * dt
          positions[i3 + 2] += velocities[i3 + 2] * dt

          // Cylindrical boundary
          const nr   = Math.sqrt(positions[i3] ** 2 + positions[i3 + 2] ** 2)
          const maxR = VESSEL_R - 0.10
          if (nr > maxR) {
            const s = maxR / nr
            positions[i3]     *= s
            positions[i3 + 2] *= s
            velocities[i3]     *= -0.35
            velocities[i3 + 2] *= -0.35
          }

          // Y boundary
          const halfH = VESSEL_H / 2 - 0.14
          if (positions[i3 + 1] >  halfH) { positions[i3 + 1] =  halfH; velocities[i3 + 1] *= -0.35 }
          if (positions[i3 + 1] < -halfH) { positions[i3 + 1] = -halfH; velocities[i3 + 1] *= -0.35 }
        }
      }

      // Push matrices + colours every frame (even when paused, keeps last state)
      for (let i = 0; i < N_PARTICLES; i++) {
        dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        dummy.updateMatrix()
        meshRef.current.setMatrixAt(i, dummy.matrix)
        meshRef.current.setColorAt(i, col)
      }
      meshRef.current.instanceMatrix.needsUpdate = true
      if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
    }

    // Rotate agitator group
    if (agitRef.current && isRunning) {
      agitRef.current.rotation.y += delta * agitSpeed
    }

    // Tint liquid cylinder
    if (liquidRef.current) {
      liquidRef.current.material.color.copy(col)
    }
  })

  const VH2 = VESSEL_H / 2  // 1.2

  return (
    <group>

      {/* ── Glass vessel wall (open-ended cylinder) ─────────────────────── */}
      <mesh>
        <cylinderGeometry args={[VESSEL_R, VESSEL_R, VESSEL_H, 48, 1, true]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.22}
          roughness={0}
          metalness={0.05}
          transmission={0.65}
          color="#99ccee"
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Bottom cap ──────────────────────────────────────────────────── */}
      <mesh position={[0, -VH2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[VESSEL_R, 48]} />
        <meshStandardMaterial color="#7aa8c0" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* ── Top lid (semi-transparent) ──────────────────────────────────── */}
      <mesh position={[0, VH2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[VESSEL_R, 48]} />
        <meshStandardMaterial color="#aaccdd" metalness={0.3} roughness={0.3} transparent opacity={0.5} />
      </mesh>

      {/* ── Liquid fill (tinted by conversion) ──────────────────────────── */}
      <mesh ref={liquidRef} position={[0, -0.12, 0]}>
        <cylinderGeometry args={[VESSEL_R - 0.03, VESSEL_R - 0.03, VESSEL_H * 0.88, 48]} />
        <meshStandardMaterial
          transparent
          opacity={0.17}
          color="#0077BB"
          depthWrite={false}
        />
      </mesh>

      {/* ── Cooling jacket ──────────────────────────────────────────────── */}
      {showJacket && (
        <group>
          {/* Jacket outer cylinder */}
          <mesh>
            <cylinderGeometry args={[1.38, 1.38, 2.0, 48, 1, true]} />
            <meshStandardMaterial
              color="#EE7733"
              transparent
              opacity={0.38}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Horizontal band rings */}
          {[-0.62, 0, 0.62].map((y, i) => (
            <mesh key={i} position={[0, y, 0]}>
              <torusGeometry args={[1.39, 0.028, 8, 48]} />
              <meshStandardMaterial color="#CC5500" />
            </mesh>
          ))}
          {/* Jacket top/bottom caps */}
          <mesh position={[0,  1.0, 0]} rotation={[ Math.PI / 2, 0, 0]}>
            <ringGeometry args={[VESSEL_R, 1.38, 48]} />
            <meshStandardMaterial color="#EE7733" transparent opacity={0.35} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -1.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[VESSEL_R, 1.38, 48]} />
            <meshStandardMaterial color="#EE7733" transparent opacity={0.35} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* ── Motor block (static, sits on top lid) ───────────────────────── */}
      <mesh position={[0, VH2 + 0.15, 0]}>
        <boxGeometry args={[0.30, 0.30, 0.30]} />
        <meshStandardMaterial color="#4a5568" metalness={0.65} roughness={0.30} />
      </mesh>
      {/* Motor housing cylinder */}
      <mesh position={[0, VH2 + 0.415, 0]}>
        <cylinderGeometry args={[0.10, 0.10, 0.16, 16]} />
        <meshStandardMaterial color="#2d3748" metalness={0.75} roughness={0.20} />
      </mesh>

      {/* ── Agitator group (shaft + impeller – all rotate together) ─────── */}
      <group ref={agitRef}>
        {/* Shaft: vessel top → 80 % depth  (y: +1.2 → −0.72) */}
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 1.92, 8]} />
          <meshStandardMaterial color="#8a9db5" metalness={0.80} roughness={0.18} />
        </mesh>

        {/* Impeller – 4 flat blades at 90° intervals, y = −0.5 */}
        {[0, 1, 2, 3].map(i => {
          const a = (i * Math.PI) / 2
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.34, -0.50, Math.sin(a) * 0.34]}
              rotation={[0, -a, 0]}
            >
              <boxGeometry args={[0.60, 0.05, 0.10]} />
              <meshStandardMaterial color="#5a7fa0" metalness={0.50} roughness={0.40} />
            </mesh>
          )
        })}
      </group>

      {/* ── Baffles – 4 thin plates on inner wall at 90° intervals ──────── */}
      {[0, 1, 2, 3].map(i => {
        const a = (i * Math.PI) / 2
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * (VESSEL_R - 0.03), 0, Math.sin(a) * (VESSEL_R - 0.03)]}
            rotation={[0, -a, 0]}
          >
            <boxGeometry args={[0.06, 1.80, 0.15]} />
            <meshStandardMaterial color="#9eb8c8" metalness={0.25} roughness={0.55} />
          </mesh>
        )
      })}

      {/* ── Feed inlet – horizontal pipe entering from top-right (+X, y = 0.7) */}
      <mesh position={[VESSEL_R + 0.30, 0.70, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.60, 12]} />
        <meshStandardMaterial color="#33BBEE" metalness={0.4} roughness={0.3} />
      </mesh>
      {/* Flange */}
      <mesh position={[VESSEL_R + 0.58, 0.70, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 0.04, 16]} />
        <meshStandardMaterial color="#2a9fc0" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* ── Product outlet – horizontal pipe exiting at bottom-left (−X, y = −1.0) */}
      <mesh position={[-(VESSEL_R + 0.30), -1.00, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.60, 12]} />
        <meshStandardMaterial color="#CC3311" metalness={0.4} roughness={0.3} />
      </mesh>
      {/* Flange */}
      <mesh position={[-(VESSEL_R + 0.58), -1.00, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 0.04, 16]} />
        <meshStandardMaterial color="#a02808" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* ── Particles (InstancedMesh) ────────────────────────────────────── */}
      <instancedMesh ref={meshRef} args={[null, null, N_PARTICLES]}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial vertexColors toneMapped={false} />
      </instancedMesh>

      {/* ── HTML Labels (attached to 3-D positions) ──────────────────────── */}
      <Html position={[VESSEL_R + 0.95, 0.70, 0]} center>
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#0077BB',
          background: 'rgba(255,255,255,0.88)',
          padding: '3px 7px', borderRadius: 5,
          border: '1px solid #93c5fd',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(0,119,187,0.18)',
        }}>
          ↑ Feed (Cₐ₀)
        </div>
      </Html>

      <Html position={[-(VESSEL_R + 0.95), -1.00, 0]} center>
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#CC3311',
          background: 'rgba(255,255,255,0.88)',
          padding: '3px 7px', borderRadius: 5,
          border: '1px solid #fca5a5',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(204,51,17,0.18)',
        }}>
          ↓ Produto (Cₐ)
        </div>
      </Html>

      {showJacket && (
        <Html position={[1.65, 0.45, 0]} center>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#CC5500',
            background: 'rgba(255,255,255,0.88)',
            padding: '3px 7px', borderRadius: 5,
            border: '1px solid #fdba74',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            boxShadow: '0 2px 6px rgba(238,119,51,0.18)',
          }}>
            🌡 Jaqueta de Resfriamento
          </div>
        </Html>
      )}

      {/* ── Live stats overlay ─────────────────────────────────────────── */}
      <Html position={[-2.55, 0.70, 0]} center>
        <StatsOverlay tauRef={oTau} xRef={oX} caRef={oCa} kRef={oK} />
      </Html>

    </group>
  )
}
