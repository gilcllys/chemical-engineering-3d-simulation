/**
 * CyclonePage2D.jsx
 * ─────────────────
 * Page wrapper for the 2-D cyclone separator simulation.
 * Controls: Start / Pause / Reset  — same visual language as CyclonePage.jsx
 */

import { useState } from 'react'
import CycloneSimulator2D from '../components/cyclone/CycloneSimulator2D'

// ── Shared button style helper ─────────────────────────────────────────────
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

// ── Paul Tol legend entries ────────────────────────────────────────────────
const LEGEND = [
  { color: '#0077BB', label: 'Muito fino  (< 5 µm)'   },
  { color: '#33BBEE', label: 'Fino  (5–15 µm)'         },
  { color: '#EE7733', label: 'Médio  (15–30 µm)'       },
  { color: '#CC3311', label: 'Grosso  (30–60 µm)'      },
  { color: '#EE3377', label: 'Muito grosso  (> 60 µm)' },
]

export default function CyclonePage2D() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  return (
    <div
      style={{
        width          : '100%',
        height         : '100%',
        overflow       : 'auto',
        display        : 'flex',
        flexDirection  : 'column',
        alignItems     : 'center',
        paddingTop     : 24,
        paddingBottom  : 32,
        background     : 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)',
        boxSizing      : 'border-box',
      }}
    >
      {/* ── Title ── */}
      <h2 style={{ color: '#1e293b', margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>
        Ciclone Separador — Visão 2D (Corte Transversal)
      </h2>
      <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 18px', textAlign: 'center', maxWidth: 480 }}>
        Partículas <span style={{ color: '#CC3311', fontWeight: 700 }}>pesadas</span> (dp&nbsp;≥&nbsp;30&nbsp;µm) →&nbsp;força centrífuga → paredes → cone → coletor&nbsp;
        |&nbsp;Partículas <span style={{ color: '#0077BB', fontWeight: 700 }}>leves</span> (dp&nbsp;&lt;&nbsp;20&nbsp;µm) → vórtice interno → saída pelo topo
      </p>

      {/* ── Simulation canvas ── */}
      {/* key=resetKey forces React to unmount + remount → fresh engine */}
      <CycloneSimulator2D key={resetKey} isRunning={isRunning} />

      {/* ── Controls ── */}
      <div
        style={{
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
        <div
          style={{
            display    : 'flex',
            alignItems : 'center',
            gap        : 6,
            paddingLeft: 8,
            borderLeft : '1px solid #e2e8f0',
            fontSize   : 12,
            fontWeight : 600,
            color      : isRunning ? '#059669' : '#d97706',
          }}
        >
          <div
            style={{
              width     : 8,
              height    : 8,
              borderRadius: '50%',
              background: isRunning ? '#059669' : '#d97706',
              animation : isRunning ? 'pulse2d 1.4s infinite' : 'none',
            }}
          />
          {isRunning ? 'Simulando' : 'Pausado'}
        </div>
      </div>

      {/* ── Legend ── */}
      <div
        style={{
          display      : 'flex',
          flexWrap     : 'wrap',
          gap          : '8px 16px',
          marginTop    : 16,
          background   : 'rgba(255,255,255,0.88)',
          borderRadius : 12,
          padding      : '10px 18px',
          boxShadow    : '0 2px 12px rgba(0,0,0,0.09)',
          border       : '1px solid rgba(0,0,0,0.07)',
          maxWidth     : 500,
          justifyContent: 'center',
        }}
      >
        <span style={{ width: '100%', fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>
          Legenda — Diâmetro de Partícula
        </span>
        {LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>

      {/* Pulse animation for status dot */}
      <style>{`
        @keyframes pulse2d {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
