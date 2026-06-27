/**
 * CSTRPage.jsx
 * ────────────
 * 3-D page wrapper for the CSTR (Continuous Stirred Tank Reactor) simulation.
 * Follows the same pattern as CyclonePage.jsx.
 *
 * Leva panel controls:  temperature, feedConc, flowRate, volume, agitSpeed, showJacket
 * Physics computed here (steady-state) and passed down to CSTR3D + InfoPanel.
 */

import { Suspense, useState } from 'react'
import { Canvas }             from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useControls, folder } from 'leva'
import { motion }             from 'framer-motion'

import CSTR3D from '../components/cstr/CSTR3D'

// ── Kinetic constants (must match CSTR3D) ────────────────────────────────────
const K0    = 0.12
const EA_R  = 5000
const T_REF = 350

// ── Shared button base style ─────────────────────────────────────────────────
const btnBase = {
  padding     : '9px 22px',
  borderRadius: 10,
  border      : 'none',
  fontWeight  : 700,
  fontSize    : 15,
  cursor      : 'pointer',
  display     : 'flex',
  alignItems  : 'center',
  gap         : 7,
  transition  : 'all 0.18s',
  boxShadow   : '0 2px 8px rgba(0,0,0,0.12)',
  userSelect  : 'none',
}

// ── Equation card ────────────────────────────────────────────────────────────
function EqCard({ title, formula, value, unit, color }) {
  return (
    <div style={{
      background  : '#f8fafc',
      border      : `1.5px solid ${color}55`,
      borderRadius: 10,
      padding     : '10px 13px',
      flex        : '1 1 170px',
      minWidth    : 170,
      boxShadow   : '0 1px 4px rgba(30,41,59,0.07)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span style={{ fontSize: 15, fontWeight: 900, color }}>
          {value}<span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 2 }}>{unit}</span>
        </span>
      </div>
      <div style={{ fontSize: 10, color, fontFamily: 'monospace', opacity: 0.85, lineHeight: 1.35 }}>
        {formula}
      </div>
    </div>
  )
}

// ── Equations drawer (slide-up panel at bottom) ──────────────────────────────
function EquationsDrawer({ k, tau, X, Ca, volume }) {
  const [open, setOpen] = useState(false)
  const effColor = X > 0.70 ? '#059669' : X > 0.40 ? '#d97706' : '#dc2626'

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60 }}>
      {/* Toggle */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background  : 'rgba(255,255,255,0.97)',
            border      : '1px solid #cbd5e1',
            borderBottom: 'none',
            borderRadius: '8px 8px 0 0',
            color       : '#475569',
            padding     : '5px 22px',
            fontSize    : 11,
            cursor      : 'pointer',
            display     : 'flex', alignItems: 'center', gap: 7,
            letterSpacing: 0.5, userSelect: 'none',
            boxShadow   : '0 -2px 6px rgba(30,41,59,0.07)',
          }}
        >
          <span>⚗️</span>
          <span style={{ fontWeight: 700 }}>EQUAÇÕES DO CSTR</span>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>▲</span>
        </button>
      </div>

      {/* Panel */}
      <div style={{
        overflow  : 'hidden',
        maxHeight : open ? '240px' : '0px',
        transition: 'max-height 0.38s ease',
        background: 'rgba(248,250,252,0.98)',
        borderTop : '1px solid #cbd5e1',
        backdropFilter: 'blur(14px)',
        boxShadow : '0 -4px 16px rgba(30,41,59,0.08)',
      }}>
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px 8px', flexWrap: 'wrap' }}>
          <EqCard
            title="Tempo de Residência"
            formula={`τ = V / Q  →  ${tau.toFixed(2)} s`}
            value={tau.toFixed(1)} unit="s" color="#7c3aed"
          />
          <EqCard
            title="Constante Cinética"
            formula={`k = k₀·exp(−Eₐ/R·(1/T−1/T₀))`}
            value={k.toFixed(4)} unit="s⁻¹" color="#0077BB"
          />
          <EqCard
            title="Conversão (estado estac.)"
            formula={`X = k·τ / (1 + k·τ)`}
            value={(X * 100).toFixed(1)} unit="%" color={effColor}
          />
          <EqCard
            title="Concentração de Saída"
            formula={`Cₐ = Cₐ₀ / (1 + k·τ)`}
            value={Ca.toFixed(3)} unit="mol/L" color="#CC3311"
          />
          <EqCard
            title="Equação de Projeto"
            formula={`V = Cₐ₀·X·Q / (k·(1−X))`}
            value={volume.toFixed(0)} unit="L" color="#EE7733"
          />
        </div>
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 18, fontSize: 10, color: '#94a3b8', flexWrap: 'wrap' }}>
          <span>k₀ = {K0} s⁻¹</span>
          <span>Eₐ/R = {EA_R} K</span>
          <span>T_ref = {T_REF} K</span>
          <span>Modelo: CSTR ideal — mistura perfeita, estado estacionário</span>
        </div>
      </div>
    </div>
  )
}

// ── InfoPanel (absolute overlay, top-left) ────────────────────────────────────
function InfoPanel({ k, tau, X, Ca }) {
  const xColor  = X > 0.70 ? '#059669' : X > 0.40 ? '#d97706' : '#dc2626'

  const row = (label, val, unit, col, bar = null) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#475569' }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: col }}>
          {val}<span style={{ fontSize: 10, marginLeft: 2, color: '#94a3b8' }}>{unit}</span>
        </span>
      </div>
      {bar !== null && (
        <div style={{ height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${bar}%` }}
            transition={{ duration: 0.5 }}
            style={{ height: '100%', background: col, borderRadius: 3 }}
          />
        </div>
      )}
    </div>
  )

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{
        position      : 'absolute', top: 16, left: 16,
        width         : 230,
        background    : 'rgba(255,255,255,0.93)',
        borderRadius  : 12,
        border        : '1px solid #cbd5e1',
        padding       : '14px 16px',
        backdropFilter: 'blur(8px)',
        boxShadow     : '0 4px 16px rgba(30,41,59,0.10)',
        zIndex        : 50,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', marginBottom: 12, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        📊 Parâmetros CSTR
      </div>

      {row('τ = V/Q  (residência)',  tau.toFixed(1), ' s',     '#7c3aed')}
      {row('k(T) = k₀·e^(−Eₐ/RT)', k.toFixed(4),   ' s⁻¹',  '#0077BB')}
      {row('X = kτ/(1+kτ)',         (X*100).toFixed(1), ' %', xColor, X * 100)}
      {row('Cₐ = Cₐ₀/(1+kτ)',      Ca.toFixed(3),  ' mol/L', '#CC3311')}

      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 10, fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
        💡 <strong style={{ color: '#475569' }}>Dica:</strong> Aumente T ou τ para maior conversão. Diminua Q ou aumente V.
      </div>
    </motion.div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CSTRPage() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  // ── Leva controls ──────────────────────────────────────────────────────────
  const params = useControls({
    'Reator CSTR': folder({
      temperature: { value: 350, min: 300, max: 500, step: 5,   label: 'Temperatura (K)'   },
      feedConc   : { value: 2.0, min: 0.1, max: 5.0, step: 0.1, label: 'Cₐ₀ (mol/L)'      },
      flowRate   : { value: 1.0, min: 0.1, max: 5.0, step: 0.1, label: 'Vazão Q (L/s)'     },
      volume     : { value: 10,  min: 1,   max: 50,  step: 1,   label: 'Volume V (L)'      },
      agitSpeed  : { value: 2.0, min: 0,   max: 8,   step: 0.1, label: 'Agitador (rpm×)'   },
      showJacket : { value: true,                                label: 'Mostrar Jaqueta'   },
    }),
  })

  // ── Steady-state physics (computed in React for the InfoPanel) ──────────────
  const k    = K0 * Math.exp(-EA_R * (1 / params.temperature - 1 / T_REF))
  const tau  = params.volume / params.flowRate
  const X_ss = (k * tau) / (1 + k * tau)
  const Ca   = params.feedConc / (1 + k * tau)

  // Key to remount CSTR3D on reset
  const sceneKey = `cstr-${resetKey}`

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          camera={{ position: [5.5, 3.5, 7], fov: 48, near: 0.1, far: 100 }}
          shadows
          style={{ background: 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)' }}
        >
          <Suspense fallback={null}>
            {/* Lighting */}
            <ambientLight intensity={1.1} />
            <directionalLight position={[5, 10, 5]}  intensity={1.6} castShadow />
            <directionalLight position={[-4, 6, -4]} intensity={0.6} color="#bfdbfe" />
            <pointLight       position={[0, -3, 0]}  intensity={0.5} color="#f59e0b" />
            <pointLight       position={[3, 2, 3]}   intensity={0.3} color="#e0f2fe" />

            {/* Grid floor */}
            <Grid
              position={[0, -1.6, 0]}
              args={[20, 20]}
              cellSize={1}     cellThickness={0.4}  cellColor="#94a3b8"
              sectionSize={5}  sectionThickness={1} sectionColor="#64748b"
              fadeDistance={22} fadeStrength={1.2}
            />

            {/* CSTR 3-D model */}
            <CSTR3D
              key={sceneKey}
              temperature={params.temperature}
              feedConc={params.feedConc}
              flowRate={params.flowRate}
              volume={params.volume}
              agitSpeed={params.agitSpeed}
              showJacket={params.showJacket}
              isRunning={isRunning}
            />

            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minDistance={2}
              maxDistance={28}
            />

            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport
                axisColors={['#dc2626', '#16a34a', '#2563eb']}
                labelColor="#1e293b"
              />
            </GizmoHelper>
          </Suspense>
        </Canvas>

        {/* ── InfoPanel overlay ─────────────────────────────────────────── */}
        <InfoPanel k={k} tau={tau} X={X_ss} Ca={Ca} />

        {/* ── CSTR badge ────────────────────────────────────────────────── */}
        <div style={{
          position      : 'absolute',
          bottom        : 24,
          right         : 20,
          zIndex        : 100,
          pointerEvents : 'none',
        }}>
          <div style={{
            display        : 'inline-flex',
            alignItems     : 'center',
            gap            : 8,
            background     : 'linear-gradient(135deg, #0077BB 0%, #005588 100%)',
            color          : '#fff',
            padding        : '6px 14px',
            borderRadius   : 999,
            fontSize       : 12,
            fontWeight     : 700,
            letterSpacing  : 0.4,
            boxShadow      : '0 2px 10px rgba(0,119,187,0.40)',
            border         : '1px solid rgba(255,255,255,0.20)',
            whiteSpace     : 'nowrap',
          }}>
            <span style={{ display: 'flex', gap: 2 }}>
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#0077BB', display: 'inline-block', border: '1px solid rgba(255,255,255,0.5)' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#EE7733', display: 'inline-block' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#CC3311', display: 'inline-block' }} />
            </span>
            Reator CSTR
          </div>
        </div>

        {/* ── Simulation control buttons ────────────────────────────────── */}
        <div style={{
          position      : 'absolute',
          bottom        : 24,
          left          : '50%',
          transform     : 'translateX(-50%)',
          display       : 'flex',
          gap           : 10,
          zIndex        : 100,
          background    : 'rgba(255,255,255,0.92)',
          borderRadius  : 18,
          padding       : '10px 18px',
          boxShadow     : '0 4px 24px rgba(0,0,0,0.14)',
          border        : '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(8px)',
          alignItems    : 'center',
        }}>
          {/* Iniciar */}
          <button
            onClick={() => setIsRunning(true)}
            disabled={isRunning}
            title="Iniciar simulação"
            style={{
              ...btnBase,
              background: isRunning ? '#d1fae5' : '#059669',
              color     : isRunning ? '#6b7280' : '#fff',
              cursor    : isRunning ? 'default' : 'pointer',
              opacity   : isRunning ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 16 }}>▶</span> Iniciar
          </button>

          {/* Pausar */}
          <button
            onClick={() => setIsRunning(false)}
            disabled={!isRunning}
            title="Pausar simulação"
            style={{
              ...btnBase,
              background: !isRunning ? '#fef3c7' : '#d97706',
              color     : !isRunning ? '#6b7280' : '#fff',
              cursor    : !isRunning ? 'default' : 'pointer',
              opacity   : !isRunning ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 16 }}>⏸</span> Pausar
          </button>

          {/* Resetar */}
          <button
            onClick={handleReset}
            title="Resetar simulação"
            style={{ ...btnBase, background: '#2563eb', color: '#fff' }}
          >
            <span style={{ fontSize: 16 }}>↺</span> Resetar
          </button>

          {/* Status indicator */}
          <div style={{
            display    : 'flex',
            alignItems : 'center',
            gap        : 6,
            paddingLeft: 8,
            borderLeft : '1px solid #e2e8f0',
            fontSize   : 12,
            fontWeight : 600,
            color      : isRunning ? '#059669' : '#d97706',
          }}>
            <div style={{
              width       : 8,
              height      : 8,
              borderRadius: '50%',
              background  : isRunning ? '#059669' : '#d97706',
              animation   : isRunning ? 'cstrPulse 1.4s infinite' : 'none',
            }} />
            {isRunning ? 'Simulando' : 'Pausado'}
          </div>
        </div>
      </div>

      {/* ── Equations drawer ─────────────────────────────────────────────── */}
      <EquationsDrawer k={k} tau={tau} X={X_ss} Ca={Ca} volume={params.volume} />

      <style>{`
        @keyframes cstrPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
