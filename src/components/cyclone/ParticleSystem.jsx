import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Represents a single particle with cyclone physics
function createParticle(cylinderRadius, cylinderHeight, coneHeight, isDust) {
  const angle = Math.random() * Math.PI * 2
  const heightFraction = Math.random()
  return {
    angle,
    radius: cylinderRadius * (0.7 + Math.random() * 0.28),
    y: coneHeight / 2 + cylinderHeight * (0.5 + heightFraction * 0.48),
    vy: 0,
    phase: Math.random() * Math.PI * 2,
    speed: 0.8 + Math.random() * 0.6,
    isDust,
    life: Math.random(),  // 0..1 normalized age
    decayRate: 0.004 + Math.random() * 0.008,
    spiralDecay: isDust ? 0.0015 : 0,
  }
}

export default function ParticleSystem({ params }) {
  const {
    cylinderRadius, cylinderHeight, coneHeight,
    particleCount, inletVelocity, particleSize, gasFlow
  } = params

  const meshRef = useRef()
  const dustMeshRef = useRef()

  const totalParticles = particleCount
  const dustCount = Math.floor(totalParticles * 0.4)
  const airCount = totalParticles - dustCount

  // Particles state stored as typed arrays for perf
  const airParticles = useRef([])
  const dustParticles = useRef([])

  useEffect(() => {
    airParticles.current = Array.from({ length: airCount }, () =>
      createParticle(cylinderRadius, cylinderHeight, coneHeight, false)
    )
    dustParticles.current = Array.from({ length: dustCount }, () =>
      createParticle(cylinderRadius, cylinderHeight, coneHeight, true)
    )
  }, [cylinderRadius, cylinderHeight, coneHeight, particleCount])

  const [airPositions, airColors] = useMemo(() => {
    const pos = new Float32Array(airCount * 3)
    const col = new Float32Array(airCount * 3)
    return [pos, col]
  }, [airCount])

  const [dustPositions, dustColors] = useMemo(() => {
    const pos = new Float32Array(dustCount * 3)
    const col = new Float32Array(dustCount * 3)
    return [pos, col]
  }, [dustCount])

  const airColor = new THREE.Color('#38bdf8')
  const dustColor = new THREE.Color('#f97316')

  const speedFactor = inletVelocity / 15
  const sizeFactor = particleSize / 50
  const yBase = -(coneHeight / 2)

  useFrame((state, delta) => {
    if (!meshRef.current || !dustMeshRef.current) return

    const t = state.clock.elapsedTime

    // Update air particles (helical path going UP in vortex finder)
    airParticles.current.forEach((p, i) => {
      p.life += p.decayRate * speedFactor * delta * 60
      if (p.life > 1) {
        Object.assign(p, createParticle(cylinderRadius, cylinderHeight, coneHeight, false))
        p.life = 0
      }

      // Air spirals inward and upward
      p.angle += delta * speedFactor * (3 + Math.random() * 0.1)
      p.radius = THREE.MathUtils.lerp(p.radius, cylinderRadius * 0.35, delta * 0.3 * speedFactor)
      p.y += delta * speedFactor * 1.5

      if (p.y > yBase + coneHeight / 2 + cylinderHeight + 1.5) {
        Object.assign(p, createParticle(cylinderRadius, cylinderHeight, coneHeight, false))
        p.life = 0
      }

      const x = Math.cos(p.angle) * p.radius
      const z = Math.sin(p.angle) * p.radius

      airPositions[i * 3] = x
      airPositions[i * 3 + 1] = p.y + yBase
      airPositions[i * 3 + 2] = z

      const fade = Math.sin(p.life * Math.PI)
      airColors[i * 3] = airColor.r * fade
      airColors[i * 3 + 1] = airColor.g * fade
      airColors[i * 3 + 2] = airColor.b * fade
    })

    // Update dust particles (spiral outward and DOWN)
    dustParticles.current.forEach((p, i) => {
      p.life += p.decayRate * speedFactor * (1 + sizeFactor) * delta * 60
      if (p.life > 1) {
        Object.assign(p, createParticle(cylinderRadius, cylinderHeight, coneHeight, true))
        p.life = 0
      }

      // Dust spirals outward to wall, then falls
      p.angle += delta * speedFactor * (2 + sizeFactor)
      p.radius = THREE.MathUtils.lerp(p.radius, cylinderRadius * 0.97, delta * 0.4 * (1 + sizeFactor))
      p.y -= delta * speedFactor * (0.5 + sizeFactor * 1.5)

      // Once below cylinder, converge to center of cone
      const coneTop = yBase + coneHeight / 2 + coneHeight
      if (p.y + yBase < coneTop) {
        const progress = (coneTop - (p.y + yBase)) / coneHeight
        p.radius = THREE.MathUtils.lerp(p.radius, 0.05, delta * progress * 2)
      }

      const x = Math.cos(p.angle) * p.radius
      const z = Math.sin(p.angle) * p.radius

      dustPositions[i * 3] = x
      dustPositions[i * 3 + 1] = p.y + yBase
      dustPositions[i * 3 + 2] = z

      const fade = Math.sin(p.life * Math.PI)
      dustColors[i * 3] = dustColor.r * fade
      dustColors[i * 3 + 1] = dustColor.g * fade * 0.5
      dustColors[i * 3 + 2] = dustColor.b * fade * 0.1
    })

    meshRef.current.geometry.attributes.position.needsUpdate = true
    meshRef.current.geometry.attributes.color.needsUpdate = true
    dustMeshRef.current.geometry.attributes.position.needsUpdate = true
    dustMeshRef.current.geometry.attributes.color.needsUpdate = true
  })

  return (
    <group>
      {/* Air flow particles */}
      {gasFlow && (
        <points ref={meshRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[airPositions, 3]} />
            <bufferAttribute attach="attributes-color" args={[airColors, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={0.05}
            vertexColors
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}

      {/* Dust particles */}
      <points ref={dustMeshRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dustPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[dustColors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.04 + sizeFactor * 0.04}
          vertexColors
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}
