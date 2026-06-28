/**
 * PFRPage.jsx
 * ───────────
 * 3D page wrapper for the Plug Flow Reactor simulation.
 * Follows the same structure as CyclonePage.jsx:
 *   · Canvas (R3F) with OrbitControls + Grid + GizmoHelper
 *   · Leva controls panel (temperature, feed concentration, flow rate, etc.)
 *   · Absolute-positioned InfoPanel overlay (left) with live metrics
 *   · Collapsible equations panel (bottom)
 *   · Start / Pause / Reset buttons
 */

import { Suspense, useState, useRef } from 'react'
import { Canvas }                     from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useControls, folder }        from 'leva'
import { motion }                     from 'framer-motion'
import { animate }                    from 'animejs'

import PFR3D from '../components/pfr/PFR3D'

// ── PFR Physics helpers (mirrored from PFR3D for InfoPanel calculations) ────
const K0    = 0.15
const EA_R  = 5000
const T_REF = 350
// A_TUBE: same tube cross-section as PFR2D (τ=8 s at Q=1 L/s, L=5 m)
const A_TUBE = 0.0016   // m²  (R ≈ 0.0226 m)

function calcK(T)  { return K0 * Math.exp(-EA_R * (1 / T - 1 / T_REF)) }

// ── Shared button base style ─────────────────────────────────────────────────
const btnBase = {
  padding:     '9px 22px',
  borderRadius: 10,
  border:      'none',
  fontWeight:  700,
  fontSize:    15,
  cursor:      'pointer',
  display:     'flex',
  alignItems:  'center',
  gap:         7,
  transition:  'all 0.18s',
  boxShadow:   '0 2px 8px rgba(0,0,0,0.12)',
  userSelect:  'none',
}

// ── Equations panel (collapsible, bottom) ────────────────────────────────────
function EquationsPanel({ k, u, tau }) {
  const [open, setOpen] = useState(false)
  const panelRef        = useRef(null)

  const toggle = () => {
    setOpen(v => {
      const next = !v
      if (panelRef.current) {
        animate(panelRef.current, {
          height:  next ? ['0px', '160px'] : ['160px', '0px'],
          opacity: next ? [0, 1]           : [1, 0],
          duration: 360,
          easing:  'easeOutQuart',
        })
      }
      return next
    })
  }

  const card = (title, formula, color) => (
    <div style={{
      background:  '#f8fafc',
      border:      `1.5px solid ${color}44`,
      borderRadius: 10,
      padding:     '9px 13px',
      minWidth:    185,
      flex:        '1 1 185px',
      boxShadow:   '0 1px 4px rgba(30,41,59,0.07)',
    }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700,
        letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color, fontFamily: 'monospace', lineHeight: 1.5 }}>
        {formula}
      </div>
    </div>
  )

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60 }}>
      {/* Toggle button */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={toggle}
          style={{
            background:   'rgba(255,255,255,0.97)',
            border:       '1px solid #cbd5e1',
            borderBottom: 'none',
            borderRadius: '8px 8px 0 0',
            color:        '#475569',
            padding:      '5px 22px',
            fontSize:     11,
            cursor:       'pointer',
            display:      'flex',
            alignItems:   'center',
            gap:          7,
            letterSpacing: 0.5,
            userSelect:   'none',
            boxShadow:    '0 -2px 6px rgba(30,41,59,0.07)',
          }}
        >
          <span>📐</span>
          <span style={{ fontWeight: 700 }}>EQUAÇÕES DO PFR</span>
          <span style={{
            display:    'inline-block',
            transform:  open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease',
          }}>▲</span>
        </button>
      </div>

      {/* Sliding panel */}
      <div
        ref={panelRef}
        style={{
          height:          0,
          overflow:        'hidden',
          background:      'rgba(248,250,252,0.98)',
          borderTop:       '1px solid #cbd5e1',
          backdropFilter:  'blur(14px)',
          boxShadow:       '0 -4px 16px rgba(30,41,59,0.08)',
        }}
      >
        <div style={{
          display:   'flex',
          gap:       8,
          padding:   '12px 16px 10px',
          flexWrap:  'wrap',
          overflowX: 'auto',
        }}>
          {card(
            'Perfil Axial',
            `CA(z) = CA₀ · exp(-k·z/u)   (sem mistura axial)`,
            '#0077BB',
          )}
          {card(
            'Conversão ao longo de z',
            `X(z) = 1 − exp(−k·z/u)`,
            '#009988',
          )}
          {card(
            'Conversão na saída',
            `X_saída = 1 − exp(−k·τ)   τ = V/Q`,
            '#CC3311',
          )}
          {card(
            'Velocidade superficial',
            `u = Q / A    τ = L / u = ${tau.toFixed(1)} s`,
            '#EE7733',
          )}
          {card(
            'Taxa de reação (Arrhenius)',
            `k(T) = k(T_ref) · exp(−Ea/R · (1/T − 1/T_ref))`,
            '#7c3aed',
          )}
        </div>
        <div style={{ padding: '0 16px 8px', fontSize: 10, color: '#94a3b8', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <span>k(T_ref) = {K0} s⁻¹</span>
          <span>Ea/R = {EA_R} K</span>
          <span>T_ref = {T_REF} K</span>
          <span>A_tubo = {(A_TUBE * 1e4).toFixed(2)} cm²</span>
          <span>Modelo: Plug Flow (sem dispersão axial)</span>
        </div>
      </div>
    </div>
  )
}

// ── Left info panel ───────────────────────────────────────────────────────────
function InfoPanel({ k, u, tau, Xexit, Caexit, feedConc }) {
  const xColor = Xexit > 0.75 ? '#16a34a' : Xexit > 0.4 ? '#d97706' : '#dc2626'

  const metric = (label, value, unit, color, bar = null) => (
    <div style={{ marginBottom: 9 }} key={label}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#475569' }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>
          {value}
          <span style={{ fontSize: 10, marginLeft: 2, color: '#94a3b8' }}>{unit}</span>
        </span>
      </div>
      {bar !== null && (
        <div style={{ height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${bar}%` }}
            transition={{ duration: 0.5 }}
            style={{ height: '100%', background: color, borderRadius: 3 }}
          />
        </div>
      )}
    </div>
  )

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0,   opacity: 1 }}
      style={{
        position:        'absolute',
        top:             16,
        left:            16,
        width:           234,
        background:      'rgba(255,255,255,0.93)',
        borderRadius:    12,
        border:          '1px solid #cbd5e1',
        padding:         '14px 16px',
        backdropFilter:  'blur(8px)',
        boxShadow:       '0 4px 16px rgba(30,41,59,0.10)',
        zIndex:          50,
      }}
    >
      <div style={{
        fontSize:      11,
        fontWeight:    700,
        color:         '#2563eb',
        marginBottom:  12,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
      }}>
        📊 Parâmetros do PFR
      </div>

      {metric('Constante de velocidade k', k.toFixed(4), 's⁻¹', '#0077BB')}
      {metric('Vel. superficial u',        u.toFixed(3),  'm/s',   '#009988')}
      {metric('Tempo de residência τ',     tau.toFixed(2), 's',    '#EE7733')}
      {metric('CA₀ (alimentação)',          feedConc.toFixed(1), 'mol/L', '#0077BB')}
      {metric('CA_saída',                   Caexit.toFixed(3),  'mol/L', '#CC3311')}
      {metric('Conversão X_saída',          (Xexit * 100).toFixed(1), '%', xColor, Xexit * 100)}

      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
          💡 <strong style={{ color: '#475569' }}>Dica:</strong> Aumente T ou L para maior conversão.
          Aumente Q para maior τ (se A fixo).
        </div>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PFRPage() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  // ── Leva controls ─────────────────────────────────────────────────────────
  const params = useControls({
    'Reator PFR': folder({
      temperature:  { value: 350,  min: 300, max: 500, step: 5,   label: 'Temperatura (K)'      },
      feedConc:     { value: 2.0,  min: 0.1, max: 5.0, step: 0.1, label: 'CA₀ (mol/L)'          },
      flowRate:     { value: 1.0,  min: 0.1, max: 5.0, step: 0.1, label: 'Vazão Q (L/s)'        },
      tubeLength:   { value: 5.0,  min: 1.0, max: 10,  step: 0.5, label: 'Comprimento L (m)'    },
      showCatalyst: { value: true,                                  label: 'Mostrar Catalisador'  },
    }),
  })

  // ── Physics for overlay panels ────────────────────────────────────────────
  const k      = calcK(params.temperature)
  const Q_m3   = params.flowRate / 1000
  const u      = Q_m3 / A_TUBE
  const tau    = params.tubeLength / u
  const Xexit  = 1 - Math.exp(-k * tau)
  const Caexit = params.feedConc * Math.exp(-k * tau)

  // physicsKey drives PFR3D re-render when controls change
  const physicsKey = `pfr-${resetKey}`

  return (
    <div style={{
      width:          '100%',
      height:         '100%',
      position:       'relative',
      display:        'flex',
      flexDirection:  'column',
    }}>

      {/* ── Canvas ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          camera={{ position: [4, 1, 7], fov: 50, near: 0.1, far: 100 }}
          shadows
          style={{ background: 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)' }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.95} />
            <directionalLight position={[5, 10, 5]}   intensity={1.55} castShadow />
            <directionalLight position={[-4, 6, -4]}  intensity={0.55} color="#bfdbfe" />
            <pointLight       position={[0, -3.5, 0]} intensity={0.45} color="#f59e0b" />

            <Grid
              position={[0, -3.2, 0]}
              args={[20, 20]}
              cellSize={1}     cellThickness={0.4}  cellColor="#94a3b8"
              sectionSize={5}  sectionThickness={1} sectionColor="#64748b"
              fadeDistance={20} fadeStrength={1.2}
            />

            <PFR3D
              key={physicsKey}
              params={params}
              isRunning={isRunning}
            />

            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minDistance={2}
              maxDistance={22}
            />

            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport
                axisColors={['#dc2626', '#16a34a', '#2563eb']}
                labelColor="#1e293b"
              />
            </GizmoHelper>
          </Suspense>
        </Canvas>

        {/* ── Absolute overlays ──────────────────────────────────── */}
        <InfoPanel
          k={k} u={u} tau={tau}
          Xexit={Xexit} Caexit={Caexit}
          feedConc={params.feedConc}
        />

        {/* ── PFR badge ──────────────────────────────────────────── */}
        <div style={{
          position:       'fixed',
          top:            12,
          right:          20,
          zIndex:         1000,
          pointerEvents:  'none',
        }}>
          <div style={{
            display:       'inline-flex',
            alignItems:    'center',
            gap:           8,
            background:    'linear-gradient(135deg, #0077BB 0%, #005588 100%)',
            color:         '#fff',
            padding:       '6px 14px',
            borderRadius:  999,
            fontSize:      12,
            fontWeight:    700,
            letterSpacing: 0.4,
            boxShadow:     '0 2px 10px rgba(0,119,187,0.40)',
            border:        '1px solid rgba(255,255,255,0.20)',
            whiteSpace:    'nowrap',
            userSelect:    'none',
          }}>
            <span style={{ display: 'flex', gap: 2 }}>
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#0077BB', display: 'inline-block' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#009988', display: 'inline-block' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#CC3311', display: 'inline-block' }} />
            </span>
            Plug Flow Reactor
          </div>
        </div>

        {/* ── Control buttons ────────────────────────────────────── */}
        <div style={{
          position:       'fixed',
          top:            12,
          left:           '50%',
          transform:      'translateX(-50%)',
          display:        'flex',
          gap:            10,
          zIndex:         1000,
          background:     'rgba(255,255,255,0.95)',
          borderRadius:   18,
          padding:        '10px 18px',
          boxShadow:      '0 4px 24px rgba(0,0,0,0.14)',
          border:         '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(10px)',
          alignItems:     'center',
        }}>
          {/* Iniciar */}
          <button
            onClick={() => setIsRunning(true)}
            disabled={isRunning}
            title="Iniciar simulação"
            style={{
              ...btnBase,
              background: isRunning ? '#d1fae5' : '#059669',
              color:      isRunning ? '#6b7280' : '#fff',
              cursor:     isRunning ? 'default' : 'pointer',
              opacity:    isRunning ? 0.6 : 1,
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
              color:      !isRunning ? '#6b7280' : '#fff',
              cursor:     !isRunning ? 'default' : 'pointer',
              opacity:    !isRunning ? 0.6 : 1,
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
            display:     'flex',
            alignItems:  'center',
            gap:         6,
            paddingLeft: 8,
            borderLeft:  '1px solid #e2e8f0',
            fontSize:    12,
            fontWeight:  600,
            color:       isRunning ? '#059669' : '#d97706',
          }}>
            <div style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   isRunning ? '#059669' : '#d97706',
              animation:    isRunning ? 'pfrPulse 1.4s infinite' : 'none',
            }} />
            {isRunning ? 'Simulando' : 'Pausado'}
          </div>
        </div>

        {/* ── Equations panel (bottom, collapsible) ──────────────── */}
        <EquationsPanel k={k} u={u} tau={tau} />
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pfrPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
