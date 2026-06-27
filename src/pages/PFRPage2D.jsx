/**
 * PFRPage2D.jsx
 * ─────────────
 * 2D page wrapper for the Plug Flow Reactor simulation.
 * Follows the same structure as CyclonePage2D.jsx.
 *
 *   · Title + description
 *   · PFR2D canvas (key=resetKey forces full remount on reset)
 *   · Start / Pause / Reset controls
 *   · Colour legend
 */

import { useState } from 'react'
import PFR2D from '../components/pfr/PFR2D'

// ── Shared button style ───────────────────────────────────────────────────────
const btnBase = {
  padding:      '9px 22px',
  borderRadius: 10,
  border:       'none',
  fontWeight:   700,
  fontSize:     15,
  cursor:       'pointer',
  display:      'flex',
  alignItems:   'center',
  gap:          7,
  transition:   'all 0.18s',
  boxShadow:    '0 2px 8px rgba(0,0,0,0.12)',
  userSelect:   'none',
}

// ── Paul Tol legend entries ───────────────────────────────────────────────────
const LEGEND = [
  { color: '#0077BB', label: 'Azul — Alta concentração A  (entrada, z = 0)'   },
  { color: '#009988', label: 'Verde — Concentração intermediária'              },
  { color: '#EE7733', label: 'Laranja — Conversão em progresso'                },
  { color: '#CC3311', label: 'Vermelho — Alta conversão X  (saída, z = L)'    },
]

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PFRPage2D() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  return (
    <div
      style={{
        width:          '100%',
        height:         '100%',
        overflow:       'auto',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        paddingTop:     24,
        paddingBottom:  32,
        background:     'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)',
        boxSizing:      'border-box',
      }}
    >
      {/* ── Title ──────────────────────────────────────────────────── */}
      <h2 style={{
        color:      '#1e293b',
        margin:     '0 0 6px',
        fontSize:   18,
        fontWeight: 800,
      }}>
        PFR — Reator Tubular de Fluxo Pistonado — Visão 2D
      </h2>

      {/* ── Description ────────────────────────────────────────────── */}
      <p style={{
        color:      '#64748b',
        fontSize:   13,
        margin:     '0 0 18px',
        textAlign:  'center',
        maxWidth:   500,
        lineHeight: 1.6,
      }}>
        <strong style={{ color: '#0077BB' }}>Sem mistura axial.</strong>{' '}
        Perfil de concentração ao longo do comprimento.
        O gradiente&nbsp;
        <span style={{ color: '#0077BB', fontWeight: 700 }}>azul</span>
        &nbsp;→&nbsp;
        <span style={{ color: '#CC3311', fontWeight: 700 }}>vermelho</span>
        &nbsp;mostra a conversão progressiva de A&nbsp;em&nbsp;B.
      </p>

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      {/* key=resetKey forces React to unmount + remount → fresh state */}
      <PFR2D key={resetKey} isRunning={isRunning} />

      {/* ── Controls ───────────────────────────────────────────────── */}
      <div
        style={{
          display:        'flex',
          gap:            10,
          marginTop:      18,
          background:     'rgba(255,255,255,0.92)',
          borderRadius:   18,
          padding:        '10px 18px',
          boxShadow:      '0 4px 24px rgba(0,0,0,0.14)',
          border:         '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(8px)',
          alignItems:     'center',
        }}
      >
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
        <div
          style={{
            display:     'flex',
            alignItems:  'center',
            gap:         6,
            paddingLeft: 8,
            borderLeft:  '1px solid #e2e8f0',
            fontSize:    12,
            fontWeight:  600,
            color:       isRunning ? '#059669' : '#d97706',
          }}
        >
          <div
            style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   isRunning ? '#059669' : '#d97706',
              animation:    isRunning ? 'pfr2dPulse 1.4s infinite' : 'none',
            }}
          />
          {isRunning ? 'Simulando' : 'Pausado'}
        </div>
      </div>

      {/* ── Colour legend ──────────────────────────────────────────── */}
      <div
        style={{
          display:        'flex',
          flexWrap:       'wrap',
          gap:            '8px 16px',
          marginTop:      16,
          background:     'rgba(255,255,255,0.88)',
          borderRadius:   12,
          padding:        '10px 18px',
          boxShadow:      '0 2px 12px rgba(0,0,0,0.09)',
          border:         '1px solid rgba(0,0,0,0.07)',
          maxWidth:       500,
          justifyContent: 'center',
        }}
      >
        <span style={{
          width:         '100%',
          fontSize:      11,
          fontWeight:    700,
          color:         '#475569',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom:  2,
        }}>
          Legenda — Gradiente Axial de Concentração
        </span>

        {LEGEND.map(({ color, label }) => (
          <div
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}
          >
            <span style={{
              width:       12,
              height:      12,
              borderRadius: '50%',
              background:  color,
              display:     'inline-block',
              boxShadow:   '0 1px 3px rgba(0,0,0,0.2)',
              flexShrink:  0,
            }} />
            {label}
          </div>
        ))}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pfr2dPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
