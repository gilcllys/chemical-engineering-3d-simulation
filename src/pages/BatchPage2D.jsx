/**
 * BatchPage2D.jsx
 * ───────────────
 * 2D page wrapper for the Batch Reactor simulation.
 *
 * · Leva controls: agitatorSpeed, temperature, initialConc, colorMode, particleCount
 * · BatchReactor2D canvas (key=resetKey forces full Matter.js re-init)
 * · Start / Pause / Reset controls
 * · Dynamic colour legend based on colorMode
 * · Arrhenius kinetics footnote
 */

import { useState } from 'react'
import { useControls, folder } from 'leva'
import BatchReactor2D from '../components/batch/BatchReactor2D'

// ── Shared button style ────────────────────────────────────────────────
const btnBase = {
  padding      : '9px 22px',
  borderRadius : 10,
  border       : 'none',
  fontWeight   : 700,
  fontSize     : 15,
  cursor       : 'pointer',
  display      : 'flex',
  alignItems   : 'center',
  gap          : 7,
  transition   : 'all 0.18s',
  boxShadow    : '0 2px 8px rgba(0,0,0,0.12)',
  userSelect   : 'none',
}

// ─────────────────────────────────────────────────────────────────────
export default function BatchPage2D() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const params = useControls({
    'Agitação & Cinética': folder({
      agitatorSpeed: { value: 1.5, min: 0,   max: 5,   step: 0.1, label: 'Velocidade Agitador' },
      temperature:   { value: 350, min: 320, max: 420, step: 5,   label: 'Temperatura (K)'     },
      initialConc:   { value: 1.0, min: 0.1, max: 5.0, step: 0.1, label: 'Ca₀ (mol/L)'         },
    }),
    'Visual': folder({
      colorMode:     { value: 'Concentração', options: ['Concentração', 'Velocidade'], label: 'Modo de Cor' },
      particleCount: { value: 4000, min: 500, max: 4000, step: 100, label: 'Nº Partículas' },
    }),
  })

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  // Legend entries depend on the active color mode
  const legendEntries = params.colorMode === 'Velocidade'
    ? [
        { color: '#0066CC', label: 'Baixa velocidade'   },
        { color: '#22D3A0', label: 'Velocidade média'   },
        { color: '#FFA500', label: 'Alta velocidade'    },
      ]
    : [
        { color: '#0077BB', label: 'Reagente A (azul)'      },
        { color: '#CC3311', label: 'Produto B (vermelho)'   },
        { color: '#EE7733', label: 'Jaqueta Térmica'         },
      ]

  return (
    <div style={{
      width         : '100%',
      height        : '100%',
      overflow      : 'auto',
      display       : 'flex',
      flexDirection : 'column',
      alignItems    : 'center',
      paddingTop    : 24,
      paddingBottom : 32,
      background    : 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)',
      boxSizing     : 'border-box',
    }}>
      {/* ── Title ──────────────────────────────────────────────────── */}
      <h2 style={{ color: '#1e293b', margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>
        Reator Batelada — Visão 2D
      </h2>

      {/* ── Description ────────────────────────────────────────────── */}
      <p style={{
        color     : '#64748b',
        fontSize  : 13,
        margin    : '0 0 18px',
        textAlign : 'center',
        maxWidth  : 520,
        lineHeight: 1.65,
        padding   : '0 12px',
      }}>
        Física real com <strong>canvas nativo</strong>: spatial hash grid + integração Verlet.
        Agitador aplica força tangencial + radial (modelo Rushton).{' '}
        Cores por <strong>{params.colorMode === 'Velocidade' ? 'velocidade' : 'conversão X'}</strong>.
      </p>

      {/* ── Canvas simulation ──────────────────────────────────────── */}
      <BatchReactor2D key={resetKey} isRunning={isRunning} params={params} />

      {/* ── Control buttons ────────────────────────────────────────── */}
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

        <button
          onClick={handleReset}
          title="Resetar simulação — reinicia reator do zero"
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
            animation   : isRunning ? 'b2dPulse 1.4s infinite' : 'none',
          }} />
          {isRunning ? 'Simulando' : 'Pausado'}
        </div>
      </div>

      {/* ── Colour legend ──────────────────────────────────────────── */}
      <div style={{
        display       : 'flex',
        flexWrap      : 'wrap',
        gap           : '8px 20px',
        marginTop     : 16,
        background    : 'rgba(255,255,255,0.88)',
        borderRadius  : 12,
        padding       : '10px 20px',
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

        {legendEntries.map(({ color, label }) => (
          <div
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#334155' }}
          >
            <span style={{
              width       : 13,
              height      : 13,
              borderRadius: '50%',
              background  : color,
              display     : 'inline-block',
              boxShadow   : '0 1px 4px rgba(0,0,0,0.18)',
              flexShrink  : 0,
            }} />
            {label}
          </div>
        ))}
      </div>

      {/* ── Kinetics footnote ──────────────────────────────────────── */}
      <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 12, textAlign: 'center' }}>
        CA(t) = CA₀ · e^(−k·t) &nbsp;|&nbsp; k(T) = k_ref · e^(−Ea/R · (1/T − 1/T_ref)) &nbsp;|&nbsp; canvas nativo + spatial hash
      </p>

      <style>{`
        @keyframes b2dPulse {
          0%, 100% { opacity: 1; transform: scale(1);   }
          50%      { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
