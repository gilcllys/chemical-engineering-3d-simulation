import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useControls, folder } from 'leva'

import CycloneModel   from '../components/cyclone/CycloneModel'
import CyclonePhysics from '../components/cyclone/CyclonePhysics'
import InfoPanel      from '../components/ui/InfoPanel'
import Legend         from '../components/ui/Legend'
import EquationsPanel from '../components/ui/EquationsPanel'
import { calcD50, calcEfficiency } from '../physics/cycloneForces'

// ── Estilos dos botões ─────────────────────────────────────────────
const btnBase = {
  padding: '9px 22px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  transition: 'all 0.18s',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  userSelect: 'none',
}

export default function CyclonePage() {
  const [isRunning, setIsRunning] = useState(true)
  const [resetKey,  setResetKey]  = useState(0)

  const handleReset = () => {
    setResetKey(k => k + 1)
    setIsRunning(true)
  }

  const params = useControls({
    'Geometria': folder({
      cylinderHeight: { value: 3,   min: 1,   max: 6,   step: 0.1,  label: 'Altura Cilindro (m)' },
      cylinderRadius: { value: 1,   min: 0.3, max: 2,   step: 0.05, label: 'Raio Cilindro (m)' },
      coneHeight:     { value: 2,   min: 0.5, max: 4,   step: 0.1,  label: 'Altura Cone (m)' },
      inletWidth:     { value: 0.4, min: 0.1, max: 0.8, step: 0.05, label: 'Largura Entrada (m)' },
    }),
    'Fluxo': folder({
      inletVelocity: { value: 15,  min: 2,  max: 40,  step: 1,  label: 'Velocidade Entrada (m/s)' },
      particleCount: { value: 200, min: 50, max: 400, step: 10, label: 'Qtd Partículas' },
      particleSize:  { value: 20,  min: 1,  max: 100, step: 1,  label: 'Tamanho Partícula (µm)' },
      gasFlow:       { value: true, label: 'Mostrar Fluxo de Gás' },
    }),
    'Visualização': folder({
      showWireframe: { value: false, label: 'Wireframe' },
      showLabels:    { value: true,  label: 'Mostrar Labels' },
      opacity:       { value: 0.65, min: 0.1, max: 1, step: 0.05, label: 'Opacidade' },
      rotateAuto:    { value: false, label: 'Rotação Automática' },
    }),
  })

  const d50_m      = calcD50(params.inletVelocity, params.cylinderRadius, params.cylinderHeight, params.coneHeight, params.inletWidth)
  const dp_m       = params.particleSize * 1e-6
  const efficiency = Math.round(calcEfficiency(dp_m, d50_m) * 100)
  const physicsKey = `${params.cylinderRadius}-${params.cylinderHeight}-${params.coneHeight}-${resetKey}`

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          camera={{ position: [6, 3.5, 7], fov: 50, near: 0.1, far: 100 }}
          shadows
          style={{ background: 'linear-gradient(180deg, #dbeafe 0%, #f0f4f8 100%)' }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={1.0} />
            <directionalLight position={[5, 10, 5]} intensity={1.6} castShadow />
            <directionalLight position={[-4, 6, -4]} intensity={0.6} color="#bfdbfe" />
            <pointLight position={[0, -3, 0]} intensity={0.4} color="#f59e0b" />

            <Grid
              position={[0, -(params.coneHeight + 0.6), 0]}
              args={[20, 20]}
              cellSize={1}    cellThickness={0.4}  cellColor="#94a3b8"
              sectionSize={5} sectionThickness={1} sectionColor="#64748b"
              fadeDistance={20} fadeStrength={1.2}
            />

            <CycloneModel params={params} />
            <CyclonePhysics key={physicsKey} params={params} isRunning={isRunning} />

            <OrbitControls
              autoRotate={params.rotateAuto} autoRotateSpeed={1}
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

        <InfoPanel params={params} efficiency={efficiency} />
        <Legend />

        {/* ── Badge estático: Coletor de Pó ────────────────────── */}
        <div style={{
          position: 'absolute',
          bottom: 24,
          right: 20,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'none',
        }}>
          {/* Pill badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.4,
            boxShadow: '0 2px 10px rgba(234,88,12,0.40)',
            border: '1px solid rgba(255,255,255,0.20)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}>
            {/* Tricolor swatch */}
            <span style={{ display: 'flex', gap: 2 }}>
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#16a34a', display: 'inline-block' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
              <span style={{ width: 4, height: 14, borderRadius: 2, background: '#dc2626', display: 'inline-block' }} />
            </span>
            Coletor de Pó
          </div>
        </div>

        {/* ── Botões de Controle da Simulação ──────────────────── */}
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 10,
          zIndex: 100,
          background: 'rgba(255,255,255,0.92)',
          borderRadius: 18,
          padding: '10px 18px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.08)',
          backdropFilter: 'blur(8px)',
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
            title="Resetar simulação — esvazia a caixa e reinicia"
            style={{
              ...btnBase,
              background: '#2563eb',
              color: '#fff',
            }}
          >
            <span style={{ fontSize: 16 }}>↺</span> Resetar
          </button>

          {/* Indicador de status */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingLeft: 8,
            borderLeft: '1px solid #e2e8f0',
            fontSize: 12,
            fontWeight: 600,
            color: isRunning ? '#059669' : '#d97706',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isRunning ? '#059669' : '#d97706',
              animation: isRunning ? 'pulse 1.4s infinite' : 'none',
            }} />
            {isRunning ? 'Simulando' : 'Pausado'}
          </div>
        </div>
      </div>

      <EquationsPanel params={params} />

      {/* Animação do indicador */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
