/**
 * CSTRPage2D.jsx
 * ──────────────
 * 2-D page wrapper for the CSTR simulation.
 * Follows the same pattern as CyclonePage2D.jsx.
 */

import { useState } from 'react'
import CSTR2D from '../components/cstr/CSTR2D'

// ── Shared button base ────────────────────────────────────────────────────────
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

// ── Legend entries ────────────────────────────────────────────────────────────
const LEGEND = [
  { color: '#0077BB', label: 'Reagente A  (Cₐ₀)  — azul'         },
  { color: '#CC3311', label: 'Produto B   (Cₐ)   — vermelho'      },
  { color: '#EE7733', label: 'Jaqueta de Resfriamento — laranja'  },
  { color: '#33BBEE', label: 'Alimentação (Feed) — azul claro'    },
]

export default function CSTRPage2D() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  return (
    <div style={{
      width         : '100%',
      height        : '100%',
      overflow      : 'auto',
      display       : 'flex',
      flexDirection : 'column',
      alignItems    : 'center',
      paddingTop    : 22,
      paddingBottom : 32,
      background    : 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)',
      boxSizing     : 'border-box',
    }}>

      {/* ── Title ── */}
      <h2 style={{
        color     : '#1e293b',
        margin    : '0 0 6px',
        fontSize  : 18,
        fontWeight: 800,
        textAlign : 'center',
      }}>
        CSTR — Reator de Tanque Agitado Contínuo — Visão 2D
      </h2>

      {/* ── Description ── */}
      <p style={{
        color    : '#64748b',
        fontSize : 13,
        margin   : '0 0 16px',
        textAlign: 'center',
        maxWidth : 520,
        lineHeight: 1.55,
      }}>
        O{' '}
        <strong style={{ color: '#1e293b' }}>CSTR</strong>{' '}
        é operado continuamente com agitação intensa, garantindo a{' '}
        <em>hipótese de mistura perfeita</em>:{' '}
        a concentração interna é uniforme e igual à concentração de saída.{' '}
        A conversão{' '}
        <span style={{ color: '#059669', fontWeight: 700 }}>X = kτ / (1 + kτ)</span>{' '}
        depende do tempo de residência τ = V/Q e da constante cinética k(T).
        A cor das partículas representa a composição média do reator —
        <span style={{ color: '#0077BB', fontWeight: 700 }}> azul </span>= reagente,
        <span style={{ color: '#CC3311', fontWeight: 700 }}> vermelho </span>= produto.
      </p>

      {/* ── Canvas ── */}
      {/* key=resetKey forces React to unmount + remount → fresh simulation */}
      <CSTR2D key={resetKey} isRunning={isRunning} />

      {/* ── Control buttons ── */}
      <div style={{
        display       : 'flex',
        gap           : 10,
        marginTop     : 18,
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
            animation   : isRunning ? 'cstr2dPulse 1.4s infinite' : 'none',
          }} />
          {isRunning ? 'Simulando' : 'Pausado'}
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{
        display       : 'flex',
        flexWrap      : 'wrap',
        gap           : '8px 18px',
        marginTop     : 14,
        background    : 'rgba(255,255,255,0.88)',
        borderRadius  : 12,
        padding       : '10px 18px',
        boxShadow     : '0 2px 12px rgba(0,0,0,0.09)',
        border        : '1px solid rgba(0,0,0,0.07)',
        maxWidth      : 520,
        justifyContent: 'center',
      }}>
        <span style={{
          width        : '100%',
          fontSize     : 11,
          fontWeight   : 700,
          color        : '#475569',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom : 2,
        }}>
          Legenda
        </span>
        {LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#334155' }}>
            <span style={{
              width       : 13,
              height      : 13,
              borderRadius: '50%',
              background  : color,
              display     : 'inline-block',
              boxShadow   : '0 1px 3px rgba(0,0,0,0.2)',
              flexShrink  : 0,
            }} />
            {label}
          </div>
        ))}
        {/* Well-mixed note */}
        <div style={{
          width    : '100%',
          fontSize : 11,
          color    : '#64748b',
          marginTop: 4,
          lineHeight: 1.5,
        }}>
          💡 Cor <strong>uniforme</strong> das partículas = hipótese de mistura perfeita.{' '}
          A cor evolui de azul (X=0) para vermelho (X→1) conforme a conversão aumenta.
        </div>
      </div>

      {/* ── Pulse animation ── */}
      <style>{`
        @keyframes cstr2dPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
