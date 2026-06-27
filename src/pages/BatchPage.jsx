/**
 * BatchPage.jsx
 * ─────────────
 * 3D page wrapper for the Batch Reactor simulation.
 * Pattern: same as CyclonePage.jsx
 *
 * Controls (Leva):
 *   temperature   – operating temperature (K)
 *   initialConc   – initial concentration Ca₀ (mol/L)
 *   agitatorSpeed – impeller angular speed multiplier
 *   showJacket    – toggle heating / cooling jacket visibility
 */

import { Suspense, useState } from 'react'
import { Canvas }             from '@react-three/fiber'
import {
  OrbitControls,
  Grid,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei'
import { useControls, folder } from 'leva'

import BatchReactor3D from '../components/batch/BatchReactor3D'

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

// ── Reaction equations displayed in the InfoPanel ──────────────────────
const EQUATIONS = [
  { sub: 'Taxa de reação (1ª ordem)',  eq: '−rA = k · CA'          },
  { sub: 'Concentração vs. tempo',     eq: 'CA(t) = CA₀ · e^(−kt)' },
  { sub: 'Conversão',                  eq: 'X = 1 − CA / CA₀'      },
  { sub: 'Arrhenius (forma modificada)',eq: 'k(T) = k(T_ref) · e^(−Ea/R·(1/T − 1/T_ref))'},
]

// ─────────────────────────────────────────────────────────────────────
export default function BatchPage() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  // ── Leva controls ────────────────────────────────────────────────────
  const params = useControls({
    'Reator Batelada': folder({
      temperature   : { value: 350, min: 300, max: 500, step: 5,   label: 'Temperatura (K)'       },
      initialConc   : { value: 1.0, min: 0.1, max: 5.0, step: 0.1, label: 'Ca₀ (mol/L)'           },
      agitatorSpeed : { value: 1.5, min: 0,   max: 5,   step: 0.1, label: 'Velocidade Agitador'   },
      showJacket    : { value: true,                                label: 'Mostrar Jaqueta'        },
    }),
  })

  return (
    <div style={{
      width: '100%', height: '100%',
      position: 'relative', display: 'flex', flexDirection: 'column',
    }}>

      {/* ── 3D canvas area ───────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          camera={{ position: [5, 3, 6], fov: 50, near: 0.1, far: 100 }}
          shadows
          style={{ background: 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)' }}
        >
          <Suspense fallback={null}>

            {/* Lighting */}
            <ambientLight intensity={1.0} />
            <directionalLight position={[5, 10, 5]}   intensity={1.6} castShadow />
            <directionalLight position={[-4, 6, -4]}  intensity={0.6} color="#bfdbfe" />
            <pointLight       position={[0, -3, 0]}   intensity={0.5} color="#f59e0b" />

            {/* Floor grid */}
            <Grid
              position={[0, -2.6, 0]}
              args={[20, 20]}
              cellSize={1}    cellThickness={0.4}  cellColor="#94a3b8"
              sectionSize={5} sectionThickness={1} sectionColor="#64748b"
              fadeDistance={20} fadeStrength={1.2}
            />

            {/* Batch reactor – key=resetKey forces full remount on reset */}
            <BatchReactor3D
              key={resetKey}
              isRunning={isRunning}
              params={params}
            />

            <OrbitControls
              enableDamping dampingFactor={0.05}
              minDistance={2} maxDistance={25}
            />

            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport
                axisColors={['#dc2626', '#16a34a', '#2563eb']}
                labelColor="#1e293b"
              />
            </GizmoHelper>

          </Suspense>
        </Canvas>

        {/* ── Equations / info panel ─────────────────────────────────── */}
        <div style={{
          position       : 'absolute',
          top            : 16,
          left           : 16,
          width          : 236,
          background     : 'rgba(255,255,255,0.93)',
          borderRadius   : 12,
          border         : '1px solid #cbd5e1',
          padding        : '14px 16px',
          zIndex         : 50,
          backdropFilter : 'blur(8px)',
          boxShadow      : '0 4px 16px rgba(30,41,59,0.10)',
        }}>
          <div style={{
            fontSize       : 11,
            fontWeight     : 700,
            color          : '#2563eb',
            marginBottom   : 10,
            letterSpacing  : 0.6,
            textTransform  : 'uppercase',
          }}>
            📐 Cinética da Reação
          </div>

          {EQUATIONS.map(({ sub, eq }) => (
            <div key={eq} style={{ marginBottom: 7 }}>
              <div style={{
                fontSize      : 9,
                color         : '#64748b',
                letterSpacing : 0.3,
                textTransform : 'uppercase',
                marginBottom  : 1,
              }}>
                {sub}
              </div>
              <div style={{
                fontSize    : 12.5,
                fontFamily  : 'monospace',
                color       : '#1e293b',
                fontWeight  : 600,
                letterSpacing: 0.2,
              }}>
                {eq}
              </div>
            </div>
          ))}

          <div style={{
            borderTop   : '1px solid #e2e8f0',
            marginTop   : 8,
            paddingTop  : 8,
            fontSize    : 9.5,
            color       : '#64748b',
            lineHeight  : 1.6,
          }}>
            k(T<sub>ref</sub>) = 0.1 s⁻¹ &nbsp;|&nbsp; Ea/R = 5 000 K &nbsp;|&nbsp; T<sub>ref</sub> = 350 K
          </div>
        </div>

        {/* ── Legend badges ──────────────────────────────────────────── */}
        <div style={{
          position      : 'absolute',
          top           : 16,
          right         : 16,
          zIndex        : 50,
          display       : 'flex',
          flexDirection : 'column',
          gap           : 6,
          pointerEvents : 'none',
        }}>
          {[
            { color: '#0077BB', label: 'Reagente A' },
            { color: '#CC3311', label: 'Produto B'  },
            { color: '#EE7733', label: 'Jaqueta Térmica' },
          ].map(({ color, label }) => (
            <div key={label} style={{
              display        : 'flex',
              alignItems     : 'center',
              gap            : 7,
              background     : 'rgba(255,255,255,0.88)',
              borderRadius   : 8,
              padding        : '5px 11px',
              fontSize       : 11,
              fontWeight     : 600,
              color          : '#334155',
              border         : '1px solid rgba(0,0,0,0.07)',
              boxShadow      : '0 1px 4px rgba(0,0,0,0.08)',
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color, display: 'inline-block',
                flexShrink: 0,
              }} />
              {label}
            </div>
          ))}
        </div>

        {/* ── Simulation control buttons ──────────────────────────────── */}
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
              background : isRunning ? '#d1fae5' : '#059669',
              color      : isRunning ? '#6b7280' : '#fff',
              cursor     : isRunning ? 'default' : 'pointer',
              opacity    : isRunning ? 0.6 : 1,
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
              background : !isRunning ? '#fef3c7' : '#d97706',
              color      : !isRunning ? '#6b7280' : '#fff',
              cursor     : !isRunning ? 'default' : 'pointer',
              opacity    : !isRunning ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 16 }}>⏸</span> Pausar
          </button>

          {/* Resetar */}
          <button
            onClick={handleReset}
            title="Resetar simulação — reinicia o reator do zero"
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
              animation   : isRunning ? 'batchPulse 1.4s infinite' : 'none',
            }} />
            {isRunning ? 'Simulando' : 'Pausado'}
          </div>
        </div>
      </div>

      {/* Pulse keyframe */}
      <style>{`
        @keyframes batchPulse {
          0%, 100% { opacity: 1; transform: scale(1);   }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
