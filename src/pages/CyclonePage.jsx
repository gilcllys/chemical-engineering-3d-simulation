import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useControls, folder } from 'leva'
import CycloneModel from '../components/cyclone/CycloneModel'
import ParticleSystem from '../components/cyclone/ParticleSystem'
import InfoPanel from '../components/ui/InfoPanel'
import Legend from '../components/ui/Legend'

export default function CyclonePage() {
  const params = useControls({
    'Geometria': folder({
      cylinderHeight: { value: 3, min: 1, max: 6, step: 0.1, label: 'Altura Cilindro (m)' },
      cylinderRadius: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Raio Cilindro (m)' },
      coneHeight: { value: 2, min: 0.5, max: 4, step: 0.1, label: 'Altura Cone (m)' },
      inletWidth: { value: 0.4, min: 0.1, max: 0.8, step: 0.05, label: 'Largura Entrada (m)' },
    }),
    'Fluxo': folder({
      inletVelocity: { value: 15, min: 2, max: 40, step: 1, label: 'Velocidade Entrada (m/s)' },
      particleCount: { value: 80, min: 20, max: 200, step: 10, label: 'Qtd Partículas' },
      particleSize: { value: 10, min: 1, max: 100, step: 1, label: 'Tamanho Partícula (µm)' },
      gasFlow: { value: true, label: 'Mostrar Fluxo de Gás' },
    }),
    'Visualização': folder({
      showWireframe: { value: false, label: 'Wireframe' },
      showLabels: { value: true, label: 'Mostrar Labels' },
      opacity: { value: 0.75, min: 0.1, max: 1, step: 0.05, label: 'Opacidade' },
      rotateAuto: { value: false, label: 'Rotação Automática' },
    }),
  })

  const efficiency = Math.min(99, Math.round(
    40 + (params.inletVelocity / 40) * 30 + (params.particleSize / 100) * 25 + (params.cylinderRadius < 1 ? 5 : 0)
  ))

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [5, 4, 6], fov: 50, near: 0.1, far: 100 }}
        shadows
        style={{ background: 'linear-gradient(180deg, #0f1729 0%, #0a0e1a 100%)' }}
      >
        <Suspense fallback={null}>
          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />
          <pointLight position={[-5, 5, -5]} intensity={0.5} color="#3b82f6" />
          <pointLight position={[0, -3, 0]} intensity={0.3} color="#f59e0b" />

          {/* Ground grid */}
          <Grid
            position={[0, -(params.cylinderHeight / 2 + params.coneHeight + 0.5), 0]}
            args={[20, 20]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#1e293b"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#334155"
            fadeDistance={20}
            fadeStrength={1}
          />

          {/* Cyclone Model */}
          <CycloneModel params={params} />

          {/* Particle System */}
          <ParticleSystem params={params} />

          {/* Camera Controls */}
          <OrbitControls
            autoRotate={params.rotateAuto}
            autoRotateSpeed={1}
            enableDamping
            dampingFactor={0.05}
            minDistance={2}
            maxDistance={20}
          />

          {/* Gizmo */}
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* UI Overlays */}
      <InfoPanel params={params} efficiency={efficiency} />
      <Legend />
    </div>
  )
}
