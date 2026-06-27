import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

function Label({ position, text, color = '#ffffff', visible = true }) {
  if (!visible) return null
  return (
    <Html position={position} center>
      <div style={{
        background: 'rgba(10,14,26,0.90)', color, padding: '3px 9px',
        borderRadius: 5, fontSize: 11, fontWeight: 700, border: `1px solid ${color}55`,
        whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: 0.3,
        textShadow: `0 0 8px ${color}88`
      }}>
        {text}
      </div>
    </Html>
  )
}

// ── Shared material presets ────────────────────────────────────────────
const FLANGE_MAT = { color: '#b0bec5', emissive: '#37474f', emissiveIntensity: 0.18, metalness: 0.90, roughness: 0.12 }
const GLASS_MAT  = { color: '#7ec8e3', emissive: '#0a2540', emissiveIntensity: 0.05, metalness: 0.08, roughness: 0.04 }
const CORNER_MAT = { color: '#b0bec5', emissive: '#37474f', emissiveIntensity: 0.18, metalness: 0.90, roughness: 0.12 }

// Corner positions (x, z) for the 4 vertical edge bars
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

export default function CycloneModel({ params }) {
  const {
    cylinderHeight, cylinderRadius, coneHeight,
    inletWidth, showWireframe, showLabels, opacity
  } = params

  const vortexRadius = cylinderRadius * 0.35
  const vortexHeight = cylinderHeight * 0.60

  // ── Posições locais (dentro do group) ───────────────────────────
  const yBase  = -(coneHeight / 2)
  const cylTop = coneHeight / 2 + cylinderHeight
  const cylMid = coneHeight / 2 + cylinderHeight / 2

  // ── Geometrias do corpo ─────────────────────────────────────────
  const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(
    cylinderRadius, cylinderRadius, cylinderHeight, 64, 1, true
  ), [cylinderRadius, cylinderHeight])

  const coneGeo = useMemo(() => new THREE.CylinderGeometry(
    cylinderRadius, 0.06, coneHeight, 64, 1, true
  ), [cylinderRadius, coneHeight])

  const topRingGeo = useMemo(() => new THREE.RingGeometry(
    vortexRadius, cylinderRadius, 64
  ), [vortexRadius, cylinderRadius])

  const vortexGeo = useMemo(() => new THREE.CylinderGeometry(
    vortexRadius, vortexRadius, vortexHeight, 32, 1, true
  ), [vortexRadius, vortexHeight])

  // Cano de saída RETO (vertical para cima)
  const outletH   = 1.60
  const outletGeo = useMemo(() => new THREE.CylinderGeometry(
    vortexRadius, vortexRadius, outletH, 32, 1, false
  ), [vortexRadius])

  // ── Entrada tangencial (extendida 0.5 para a direita) ───────────
  const inletExtW    = inletWidth * 1.2 + 0.5          // total X length
  const inletCenterX = cylinderRadius + inletWidth * 0.20 + 0.25
  const inletRightX  = inletCenterX + inletExtW / 2

  const inletGeo = useMemo(() => new THREE.BoxGeometry(
    inletWidth * 1.2 + 0.5, inletWidth * 1.4, cylinderRadius * 0.85
  ), [inletWidth, cylinderRadius])

  const dustExitGeo = useMemo(() => new THREE.CylinderGeometry(0.07, 0.07, 0.50, 16), [])

  // ── Caixa coletora ────────────────────────────────────────────── 
  const boxH       = 2.00
  const boxW       = 1.80
  const boxD       = 1.80
  const boxCenterY = -coneHeight / 2 - 0.55 - boxH / 2
  const boxFloorY  = boxCenterY - boxH / 2 + 0.03

  // ── Indicador de nível — 3 segmentos na borda esquerda ──────────
  const fillBarX    = -boxW / 2 - 0.08
  const segH        = boxH / 3
  const seg1CenterY = boxCenterY - boxH / 2 + segH * 0.5   // verde  – fundo
  const seg2CenterY = boxCenterY - boxH / 2 + segH * 1.5   // amarelo – meio
  const seg3CenterY = boxCenterY - boxH / 2 + segH * 2.5   // vermelho – topo

  // ── Helpers de material ──────────────────────────────────────────
  const mat = (color, emissive = '#000') => (
    <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.12}
      metalness={0.65} roughness={0.28} transparent opacity={opacity}
      side={THREE.DoubleSide} wireframe={showWireframe} />
  )
  const solidMat = (color, emissive = '#000') => (
    <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.1}
      metalness={0.7} roughness={0.22} transparent
      opacity={Math.min(1, opacity + 0.15)} wireframe={showWireframe} />
  )

  return (
    <group position={[0, yBase, 0]}>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── CORPO DO CICLONE ─────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Cilindro externo */}
      <mesh geometry={cylinderGeo} position={[0, cylMid, 0]} castShadow receiveShadow>
        {mat('#3a7d94', '#0d3347')}
      </mesh>

      {/* Tampa anular */}
      <mesh geometry={topRingGeo} position={[0, cylTop, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {solidMat('#2a5c6e')}
      </mesh>

      {/* Cone */}
      <mesh geometry={coneGeo} position={[0, 0, 0]} castShadow>
        {mat('#3a7d94', '#0d3347')}
      </mesh>

      {/* ── FLANGE: junção cilindro / cone ────────────────────────── */}
      <mesh position={[0, coneHeight / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[cylinderRadius + 0.06, 0.045, 10, 64]} />
        <meshStandardMaterial {...FLANGE_MAT} wireframe={showWireframe} />
      </mesh>

      {/* Vortex finder (cilindro interno) */}
      <mesh geometry={vortexGeo} position={[0, cylTop - vortexHeight / 2, 0]}>
        <meshStandardMaterial color="#5bc8f5" emissive="#0284c7" emissiveIntensity={0.35}
          metalness={0.4} roughness={0.25} transparent opacity={opacity * 0.85}
          side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* Cano de saída reto */}
      <mesh geometry={outletGeo} position={[0, cylTop + outletH / 2, 0]} castShadow>
        <meshStandardMaterial color="#5bc8f5" emissive="#0284c7" emissiveIntensity={0.30}
          metalness={0.55} roughness={0.20} transparent opacity={opacity}
          side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* ── FLANGE: topo do cano de saída ─────────────────────────── */}
      <mesh position={[0, cylTop + outletH, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[vortexRadius + 0.07, 0.036, 10, 32]} />
        <meshStandardMaterial {...FLANGE_MAT} wireframe={showWireframe} />
      </mesh>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── ENTRADA TANGENCIAL (extendida) ───────────────────────── */}
      {/* ══════════════════════════════════════════════════════════ */}

      <mesh geometry={inletGeo}
        position={[inletCenterX, cylTop - inletWidth * 0.8, 0]}>
        {solidMat('#1e4d5c')}
      </mesh>

      {/* Flange de abertura (far end) */}
      <mesh position={[inletRightX, cylTop - inletWidth * 0.8, 0]}>
        <boxGeometry args={[0.065, inletWidth * 1.4 + 0.14, cylinderRadius * 0.85 + 0.14]} />
        <meshStandardMaterial color="#b0bec5" emissive="#37474f" emissiveIntensity={0.14}
          metalness={0.85} roughness={0.18} wireframe={showWireframe} />
      </mesh>

      {/* Tubo de saída de pó */}
      <mesh geometry={dustExitGeo} position={[0, -coneHeight / 2 - 0.25, 0]}>
        {solidMat('#7c3700', '#3a1a00')}
      </mesh>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── CAIXA COLETORA — INDUSTRIAL GLASS CONTAINER ─────────── */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Piso sólido (dark metal) */}
      <mesh position={[0, boxFloorY, 0]}>
        <boxGeometry args={[boxW + 0.04, 0.06, boxD + 0.04]} />
        <meshStandardMaterial color="#4a2200" emissive="#1a0a00" emissiveIntensity={0.12}
          metalness={0.55} roughness={0.55}
          transparent opacity={Math.min(1, opacity + 0.25)} wireframe={showWireframe} />
      </mesh>

      {/* Parede frontal (z+) */}
      <mesh position={[0, boxCenterY, boxD / 2]}>
        <boxGeometry args={[boxW, boxH, 0.04]} />
        <meshStandardMaterial {...GLASS_MAT} transparent opacity={0.25}
          depthWrite={false} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* Parede traseira (z-) */}
      <mesh position={[0, boxCenterY, -boxD / 2]}>
        <boxGeometry args={[boxW, boxH, 0.04]} />
        <meshStandardMaterial {...GLASS_MAT} transparent opacity={0.25}
          depthWrite={false} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* Parede esquerda (x-) */}
      <mesh position={[-boxW / 2, boxCenterY, 0]}>
        <boxGeometry args={[0.04, boxH, boxD]} />
        <meshStandardMaterial {...GLASS_MAT} transparent opacity={0.25}
          depthWrite={false} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* Parede direita (x+) */}
      <mesh position={[boxW / 2, boxCenterY, 0]}>
        <boxGeometry args={[0.04, boxH, boxD]} />
        <meshStandardMaterial {...GLASS_MAT} transparent opacity={0.25}
          depthWrite={false} side={THREE.DoubleSide} wireframe={showWireframe} />
      </mesh>

      {/* ── Cantoneiras metálicas — 4 arestas verticais ────────────── */}
      {CORNERS.map(([sx, sz], i) => (
        <mesh key={`corner-${i}`}
          position={[sx * boxW / 2, boxCenterY, sz * boxD / 2]}>
          <cylinderGeometry args={[0.032, 0.032, boxH, 8]} />
          <meshStandardMaterial {...CORNER_MAT} wireframe={showWireframe} />
        </mesh>
      ))}

      {/* ── Marcações de nível (25 / 50 / 75 %) — parede frontal ──── */}
      {[0.25, 0.50, 0.75].map((pct, i) => (
        <mesh key={`grad-${i}`}
          position={[0, boxCenterY - boxH / 2 + boxH * pct, boxD / 2 + 0.028]}>
          <boxGeometry args={[boxW - 0.14, 0.008, 0.010]} />
          <meshStandardMaterial color="#334155" transparent opacity={0.72}
            depthWrite={false} wireframe={showWireframe} />
        </mesh>
      ))}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── INDICADOR DE NÍVEL — barra tricolor (estático) ──────── */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Segmento verde — fundo (0–33 %) */}
      <mesh position={[fillBarX, seg1CenterY, 0]}>
        <boxGeometry args={[0.08, segH - 0.02, 0.08]} />
        <meshStandardMaterial color="#16a34a" emissive="#14532d" emissiveIntensity={0.22}
          metalness={0.30} roughness={0.40} wireframe={showWireframe} />
      </mesh>

      {/* Segmento amarelo — meio (33–66 %) */}
      <mesh position={[fillBarX, seg2CenterY, 0]}>
        <boxGeometry args={[0.08, segH - 0.02, 0.08]} />
        <meshStandardMaterial color="#f59e0b" emissive="#78350f" emissiveIntensity={0.22}
          metalness={0.30} roughness={0.40} wireframe={showWireframe} />
      </mesh>

      {/* Segmento vermelho — topo (66–100 %) */}
      <mesh position={[fillBarX, seg3CenterY, 0]}>
        <boxGeometry args={[0.08, segH - 0.02, 0.08]} />
        <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.22}
          metalness={0.30} roughness={0.40} wireframe={showWireframe} />
      </mesh>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── LABELS ───────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════ */}

      <Label position={[cylinderRadius + 2.2, cylTop - inletWidth * 0.8, 0]}
        text="→ Entrada de Ar (com partículas)" color="#EE7733" visible={showLabels} />

      <Label position={[vortexRadius + 1.2, cylTop + outletH + 0.3, 0]}
        text="↑ Saída de Ar Limpo (Overflow)" color="#33BBEE" visible={showLabels} />

      <Label position={[cylinderRadius + 1.3, cylMid, 0]}
        text="Parede Exterior" color="#BBBBBB" visible={showLabels} />

      <Label position={[vortexRadius + 1.0, cylTop - vortexHeight / 2, 0]}
        text="Vortex Finder (Cilindro Interno)" color="#5bc8f5" visible={showLabels} />

      <Label position={[cylinderRadius + 1.1, -coneHeight * 0.25, 0]}
        text="Cone Separador" color="#AA44AA" visible={showLabels} />

      <Label position={[0.75, boxCenterY, 0]}
        text="Coletor de Pó (Underflow)" color="#EE3377" visible={showLabels} />
    </group>
  )
}
