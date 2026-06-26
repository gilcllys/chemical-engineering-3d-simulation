import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Html } from '@react-three/drei'
import * as THREE from 'three'

function Label({ position, text, color = '#ffffff', visible = true }) {
  if (!visible) return null
  return (
    <Html position={position} center>
      <div style={{
        background: 'rgba(10,14,26,0.85)', color, padding: '3px 8px',
        borderRadius: 5, fontSize: 11, fontWeight: 600, border: `1px solid ${color}40`,
        whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: 0.3
      }}>
        {text}
      </div>
    </Html>
  )
}

export default function CycloneModel({ params }) {
  const {
    cylinderHeight, cylinderRadius, coneHeight,
    inletWidth, showWireframe, showLabels, opacity
  } = params

  const totalHeight = cylinderHeight + coneHeight
  const yOffset = totalHeight / 2 - cylinderHeight / 2

  // Outer cylinder geometry
  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(
    cylinderRadius, cylinderRadius, cylinderHeight, 64, 1, true
  ), [cylinderRadius, cylinderHeight])

  // Cone geometry
  const coneGeo = useMemo(() => new THREE.CylinderGeometry(
    0.08, cylinderRadius, coneHeight, 64, 1, true
  ), [cylinderRadius, coneHeight])

  // Top cap
  const topCapGeo = useMemo(() => new THREE.CircleGeometry(cylinderRadius, 64), [cylinderRadius])

  // Inner vortex finder (cylindro interno)
  const vortexRadius = cylinderRadius * 0.35
  const vortexHeight = cylinderHeight * 0.6
  const vortexGeo = useMemo(() => new THREE.CylinderGeometry(
    vortexRadius, vortexRadius, vortexHeight, 32, 1, true
  ), [vortexRadius, vortexHeight])

  // Outlet duct (saída de ar limpo)
  const outletGeo = useMemo(() => new THREE.CylinderGeometry(
    vortexRadius, vortexRadius, 1.5, 32, 1, true
  ), [vortexRadius])

  // Inlet duct (entrada tangencial)
  const inletGeo = useMemo(() => new THREE.BoxGeometry(inletWidth, inletWidth * 1.5, cylinderRadius * 0.8), [inletWidth, cylinderRadius])

  // Dust exit pipe (saída de pó)
  const dustExitGeo = useMemo(() => new THREE.CylinderGeometry(0.06, 0.06, 0.6, 16), [])

  const material = (color, emissive = '#000000') => (
    <meshStandardMaterial
      color={color}
      emissive={emissive}
      emissiveIntensity={0.1}
      metalness={0.6}
      roughness={0.3}
      transparent
      opacity={opacity}
      side={THREE.DoubleSide}
      wireframe={showWireframe}
    />
  )

  const solidMaterial = (color) => (
    <meshStandardMaterial
      color={color}
      metalness={0.7}
      roughness={0.2}
      transparent
      opacity={Math.min(1, opacity + 0.2)}
      wireframe={showWireframe}
    />
  )

  const yBase = -(coneHeight / 2)

  return (
    <group position={[0, yBase, 0]}>
      {/* === OUTER CYLINDER === */}
      <mesh geometry={cylinderGeo} position={[0, coneHeight / 2 + cylinderHeight / 2, 0]} castShadow receiveShadow>
        {material('#4a90a4', '#1e3a5f')}
      </mesh>

      {/* Top cap */}
      <mesh geometry={topCapGeo} position={[0, coneHeight / 2 + cylinderHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {solidMaterial('#2c5f6e')}
      </mesh>

      {/* === CONE === */}
      <mesh geometry={coneGeo} position={[0, 0, 0]} castShadow>
        {material('#4a90a4', '#1e3a5f')}
      </mesh>

      {/* === INNER VORTEX FINDER === */}
      <mesh geometry={vortexGeo}
        position={[0, coneHeight / 2 + cylinderHeight - vortexHeight / 2, 0]}
        castShadow>
        <meshStandardMaterial
          color="#7dd3fc"
          emissive="#0ea5e9"
          emissiveIntensity={0.3}
          metalness={0.4}
          roughness={0.3}
          transparent
          opacity={opacity * 0.8}
          side={THREE.DoubleSide}
          wireframe={showWireframe}
        />
      </mesh>

      {/* === OUTLET DUCT (top) === */}
      <mesh geometry={outletGeo}
        position={[0, coneHeight / 2 + cylinderHeight + 0.75, 0]}>
        <meshStandardMaterial color="#38bdf8" metalness={0.5} roughness={0.3}
          transparent opacity={opacity} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* Outlet elbow horizontal */}
      <mesh position={[cylinderRadius * 0.8, coneHeight / 2 + cylinderHeight + 1.4, 0]}
        rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[vortexRadius, vortexRadius, cylinderRadius * 1.6, 16, 1, true]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.5} roughness={0.3}
          transparent opacity={opacity} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* === INLET DUCT (tangential) === */}
      <mesh geometry={inletGeo}
        position={[cylinderRadius + inletWidth * 0.1, coneHeight / 2 + cylinderHeight - inletWidth * 0.75, 0]}>
        {solidMaterial('#2c5f6e')}
      </mesh>

      {/* === DUST EXIT === */}
      <mesh geometry={dustExitGeo} position={[0, -coneHeight / 2 - 0.3, 0]}>
        {solidMaterial('#78350f')}
      </mesh>

      {/* Dust collection barrel */}
      <mesh position={[0, -coneHeight / 2 - 0.85, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 16]} />
        <meshStandardMaterial color="#92400e" metalness={0.3} roughness={0.6}
          transparent opacity={Math.min(1, opacity + 0.15)} wireframe={showWireframe} />
      </mesh>

      {/* === LABELS === */}
      <Label position={[cylinderRadius + 1.8, coneHeight / 2 + cylinderHeight - inletWidth * 0.75, 0]}
        text="↑ Entrada de Ar (com partículas)" color="#fbbf24" visible={showLabels} />

      <Label position={[cylinderRadius * 1.6 + 0.8, coneHeight / 2 + cylinderHeight + 1.4, 0]}
        text="→ Saída de Ar Limpo" color="#38bdf8" visible={showLabels} />

      <Label position={[cylinderRadius + 1.2, coneHeight / 2 + cylinderHeight * 0.5, 0]}
        text="Parede Exterior" color="#94a3b8" visible={showLabels} />

      <Label position={[vortexRadius + 0.8, coneHeight / 2 + cylinderHeight - vortexHeight / 2, 0]}
        text="Cilindro Interno (Vortex Finder)" color="#7dd3fc" visible={showLabels} />

      <Label position={[cylinderRadius + 0.8, -coneHeight * 0.3, 0]}
        text="Cone Separador" color="#86efac" visible={showLabels} />

      <Label position={[0.5, -coneHeight / 2 - 0.85, 0]}
        text="↓ Saída de Pó" color="#f97316" visible={showLabels} />
    </group>
  )
}
