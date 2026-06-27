/**
 * BatchReactor3D.jsx — CPU-PBD particle physics + dye-advection fluid
 *
 * Particles (12 000):
 *  · pos/vel/dye stored in plain Float32Array — zero GPU render targets
 *  · Pass 1: integrate gravity, buoyancy, Rushton impeller, wall/floor/shaft/blade
 *  · Pass 2: build spatial hash (cell = PARTICLE_D = 0.056)
 *  · Pass 3: PBD collision resolution — guaranteed non-overlap
 *  · Pass 4: write to BufferGeometry position+color attributes (DynamicDrawUsage)
 *  · Render: THREE.Points with sphere-impostor ShaderMaterial
 *            (gl_PointCoord → disc → gl_FragDepth → solid 3D spheres)
 *
 * Dye advection (unchanged):
 *  · 128×128 ping-pong for the liquid body / animated surface shaders
 */

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// ── Cinética ──────────────────────────────────────────────────────────────────
const K0 = 0.1, EA_R = 5000, T_REF = 350
const computeK = T => K0 * Math.exp(-EA_R * (1/T - 1/T_REF))

// ── Geometria ─────────────────────────────────────────────────────────────────
const LIQUID_R    = 0.87
const LIQUID_BOT  = -1.32
const LIQUID_TOP  = -0.05
const LIQUID_H    = LIQUID_TOP - LIQUID_BOT   // 1.27
const LIQUID_FILL = LIQUID_BOT + LIQUID_H * 0.70
const SURF_SEGS   = 64
const SURF_RINGS  = 40
const BUBBLE_COUNT  = 40
const BUBBLE_R      = 0.030

// ── CPU-physics particle parameters ──────────────────────────────────────────
const PARTICLE_COUNT = 12000
const PARTICLE_R     = 0.028          // world-space radius
const PARTICLE_D     = PARTICLE_R * 2 // collision distance = 0.056

// ── Spatial hash grid (cell = PARTICLE_D so each particle touches ≤27 cells) ─
const G_CELL = PARTICLE_D
const G_OX   = -(LIQUID_R + G_CELL * 2)
const G_OY   = LIQUID_BOT - G_CELL
const G_OZ   = -(LIQUID_R + G_CELL * 2)
const G_NX   = Math.ceil((LIQUID_R * 2 + G_CELL * 4) / G_CELL) + 1
const G_NY   = Math.ceil((LIQUID_H   + G_CELL * 2)   / G_CELL) + 1
const G_NZ   = G_NX
const G_SZ   = G_NX * G_NY * G_NZ

// ── Cores ─────────────────────────────────────────────────────────────────────
const COL_A = new THREE.Color('#0099EE')   // azul  (reagente)
const COL_B = new THREE.Color('#FF4400')   // laranja-vermelho (produto)

// ── Shader: advecção do corante (ping-pong) ───────────────────────────────────
const ADVECT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const ADVECT_FRAG = /* glsl */`
  precision mediump float;
  #define PI 3.14159265

  uniform sampler2D uDye;
  uniform float     uDt;
  uniform float     uAgitSpeed;
  uniform float     uTime;
  uniform float     uConv;
  uniform vec3      uColorA;
  uniform vec3      uColorB;

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    /* ── Velocidade em espaço UV ─────────────────────────────────────────── */
    /* U = ângulo / 2π (0..1), V = altura normalizada (0..1)                 */

    /* Rotação tangencial do impelidor: omega rad/s → dU/dt = omega / 2π     */
    float velU = uAgitSpeed * 0.18;

    /* Circulação axial Rushton: sobe na parede (V > 0.55), desce no centro   */
    float dy   = uv.y - 0.551;
    float velV = uAgitSpeed * 0.10 * sign(dy) * exp(-abs(dy) * 2.5);

    /* Turbulência: cria padrões de mistura swirling (como dli/fluid)        */
    float tr = uAgitSpeed * 0.018;
    float p  = uv.x * 6.28 + uv.y * 4.71 + uTime * uAgitSpeed * 0.6;
    velU += tr * cos(p);
    velV += tr * sin(p * 0.7 + 1.57);
    velU += tr * 0.5 * sin(uv.y * 8.0 + uTime * 2.1);
    velV += tr * 0.5 * cos(uv.x * 6.0 - uTime * 1.8);

    /* Semi-Lagrangiana: de onde vem este texel? */
    vec2 prev = uv - vec2(velU, velV) * uDt;
    prev.x = mod(prev.x + 10.0, 1.0);           /* wrap horizontal (periódico) */
    prev.y = clamp(prev.y, 0.005, 0.995);        /* clamp vertical             */

    vec4 dyeColor = texture2D(uDye, prev);

    /* Mistura lenta com a cor da reação (A→B conforme conversão avança) */
    float blendRate = uConv * uAgitSpeed * 0.006 + 0.0008;
    vec4  reactionTarget = mix(vec4(uColorA, 1.0), vec4(uColorB, 1.0), uConv);
    dyeColor = mix(dyeColor, reactionTarget, blendRate);

    gl_FragColor = dyeColor;
  }
`

// ── Shader: corpo do líquido (amostra corante + profundidade + Fresnel) ────────
const BODY_VERT = /* glsl */`
  uniform float uLiqBot;
  uniform float uLiqH;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vAngleNorm;
  varying float vHeightNorm;

  void main() {
    vec4 wp    = modelMatrix * vec4(position, 1.0);
    vWorldPos  = wp.xyz;
    vNormal    = normalize(normalMatrix * normal);
    vAngleNorm = atan(position.z, position.x) / (2.0 * 3.14159265) + 0.5;
    vHeightNorm = clamp((position.y - uLiqBot) / uLiqH, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const BODY_FRAG = /* glsl */`
  precision mediump float;
  uniform sampler2D uDye;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vAngleNorm;
  varying float vHeightNorm;

  void main() {
    /* Amostra o campo de corante na posição deste fragmento */
    vec3 col = texture2D(uDye, vec2(vAngleNorm, vHeightNorm)).rgb;

    /* Escurecimento por profundidade (igual ao WebGPU Ocean) */
    float depth = 1.0 - vHeightNorm;
    col *= mix(1.35, 0.40, depth * depth);

    /* Fresnel: bordas → espalhamento ciano brilhante */
    vec3  viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.5);
    col = mix(col, mix(col * 1.3, vec3(0.55, 0.92, 1.0), 0.5), fresnel * 0.65);

    gl_FragColor = vec4(col, 0.92);
  }
`

// ── Shader: superfície animada (amostra corante no topo + Fresnel + especular) ─
const SURF_VERT = /* glsl */`
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vLocalY;
  varying float vAngleNorm;

  void main() {
    vec4 wp    = modelMatrix * vec4(position, 1.0);
    vWorldPos  = wp.xyz;
    vNormal    = normalize(normalMatrix * normal);
    vLocalY    = position.y;
    vAngleNorm = atan(position.z, position.x) / (2.0 * 3.14159265) + 0.5;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const SURF_FRAG = /* glsl */`
  precision mediump float;
  uniform sampler2D uDye;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vLocalY;
  varying float vAngleNorm;

  void main() {
    /* Amostra o corante na borda superior (V=0.98) */
    float v   = clamp(0.98 - (-vLocalY) * 0.5, 0.5, 0.99);
    vec3  col = texture2D(uDye, vec2(vAngleNorm, v)).rgb;

    /* Centro do vórtice fica mais escuro (água mais funda) */
    float depth = clamp(-vLocalY / 0.85, 0.0, 1.0);
    col = mix(col * 1.4, col * 0.3, depth);

    /* Fresnel + reflexo de céu */
    vec3  viewDir = normalize(cameraPosition - vWorldPos);
    vec3  norm    = normalize(vNormal);
    float fresnel = pow(1.0 - abs(dot(viewDir, norm)), 3.0);
    col = mix(col, vec3(0.72, 0.88, 1.0), fresnel * 0.45);

    /* Especular dourado quente (como no WebGPU Ocean) */
    vec3  lDir = normalize(vec3(4.0, 9.0, 5.0));
    vec3  half = normalize(lDir + viewDir);
    float spec = pow(max(dot(norm, half), 0.0), 120.0);
    col += vec3(1.0, 0.80, 0.30) * spec * 1.4;

    col += col * 0.15;
    gl_FragColor = vec4(col, 0.97);
  }
`

// ── Sphere-impostor shaders (CPU physics + gl_FragDepth trick) ────────────────
// Three.js injects: #version 300 es, precision, projectionMatrix, modelViewMatrix,
// position (in vec3). We only declare our custom `color` attribute + varyings.

const SPHERE_VERT = /* glsl */`
  precision highp float;

  in vec3 color;       // depth-gradient color from BufferGeometry attribute

  out vec3 vColor;
  out vec3 vCenterEye; // sphere center in eye space
  out float vRadius;

  uniform float uRadius;

  void main() {
    vColor = color;
    vec4 eyePos  = modelViewMatrix * vec4(position, 1.0);
    vCenterEye   = eyePos.xyz;
    vRadius      = uRadius;

    vec4 clipPos     = projectionMatrix * eyePos;
    // Scale billboard to cover sphere projected radius (+5% margin)
    float screenRad  = uRadius * projectionMatrix[1][1] / max(clipPos.w, 0.0001) * 1.05;
    gl_PointSize     = max(2.0, screenRad * 600.0);
    gl_Position      = clipPos;
  }
`

const SPHERE_FRAG = /* glsl */`
  precision highp float;

  in vec3  vColor;
  in vec3  vCenterEye;
  in float vRadius;

  out vec4 fragColor;

  void main() {
    // Map gl_PointCoord [0,1] → disc [-1,1]
    vec2  uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;          // outside circle → clip

    // Reconstruct sphere surface normal
    float z      = sqrt(1.0 - r2);
    vec3  normal = vec3(uv, z);

    // Surface point in eye space → correct depth per fragment
    vec3  surfEye    = vCenterEye + normal * vRadius;
    vec4  clipSurf   = projectionMatrix * vec4(surfEye, 1.0);
    gl_FragDepth     = (clipSurf.z / clipSurf.w) * 0.5 + 0.5;

    // Blinn-Phong (light in eye space)
    vec3  lightDir = normalize(vec3(1.0, 2.0, 1.5));
    float diff     = max(0.0, dot(normal, lightDir));
    vec3  halfDir  = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec     = pow(max(0.0, dot(normal, halfDir)), 40.0);

    vec3 col   = vColor * (0.25 + 0.75 * diff) + vec3(0.5) * spec * 0.3;
    fragColor  = vec4(col, 1.0);
  }
`

// ─────────────────────────────────────────────────────────────────────────────
export default function BatchReactor3D({ isRunning, params }) {
  const { temperature, initialConc, agitatorSpeed, showJacket } = params
  const { gl } = useThree()

  // ── Refs ──────────────────────────────────────────────────────────────────
  const agitatorRef = useRef(null)
  const surfaceRef  = useRef(null)
  const bubblesRef  = useRef(null)
  const timeRef     = useRef(0)
  const runRef      = useRef(isRunning)
  const agitAngle   = useRef(0)
  const domConv     = useRef(null)
  const domCa       = useRef(null)
  const domK        = useRef(null)
  const hCurrent    = useRef(null)
  const hVel        = useRef(null)
  const dyeIdx      = useRef(0)   // ping-pong index for dye advection
  const ptclGeoRef  = useRef(null) // ref to the <points> mesh

  useEffect(() => { runRef.current = isRunning }, [isRunning])

  // ── Render targets para advecção (ping-pong) ──────────────────────────────
  const dyeTargets = useMemo(() => [
    new THREE.WebGLRenderTarget(128, 128, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false,
    }),
    new THREE.WebGLRenderTarget(128, 128, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false,
    }),
  ], [])

  // ── CPU-physics data (allocated once, NEVER reallocated in useFrame) ─────────
  const pData = useMemo(() => {
    const pos  = new Float32Array(PARTICLE_COUNT * 3)
    const vel  = new Float32Array(PARTICLE_COUNT * 3)
    const dye  = new Float32Array(PARTICLE_COUNT)
    const head = new Int32Array(G_SZ).fill(-1)
    const next = new Int32Array(PARTICLE_COUNT).fill(-1)
    // Scatter particles randomly inside cylinder, bottom 68% height
    let n = 0
    while (n < PARTICLE_COUNT) {
      const x = (Math.random() * 2 - 1) * (LIQUID_R - 0.06)
      const z = (Math.random() * 2 - 1) * (LIQUID_R - 0.06)
      if (x*x + z*z < (LIQUID_R - 0.06) * (LIQUID_R - 0.06)) {
        pos[n*3]   = x
        pos[n*3+1] = LIQUID_BOT + Math.random() * LIQUID_H * 0.68
        pos[n*3+2] = z
        n++
      }
    }
    return { pos, vel, dye, head, next }
  }, [])

  // ── Particle BufferGeometry — dynamic positions + depth-gradient colors ───
  const ptclGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(PARTICLE_COUNT * 3)
    const col = new Float32Array(PARTICLE_COUNT * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage))
    return geo
  }, [])

  // ── Sphere-impostor ShaderMaterial ────────────────────────────────────────
  const ptclMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SPHERE_VERT,
    fragmentShader: SPHERE_FRAG,
    uniforms: { uRadius: { value: PARTICLE_R } },
    glslVersion: THREE.GLSL3,
  }), [])

  // ── Cena de advecção (quad 2D) ────────────────────────────────────────────
  const advObj = useMemo(() => {
    const scene  = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uDye:       { value: null },
        uDt:        { value: 0.016 },
        uAgitSpeed: { value: 0 },
        uTime:      { value: 0 },
        uConv:      { value: 0 },
        uColorA:    { value: COL_A.clone() },
        uColorB:    { value: COL_B.clone() },
      },
      vertexShader:   ADVECT_VERT,
      fragmentShader: ADVECT_FRAG,
      depthTest: false, depthWrite: false,
    })
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    return { scene, camera, mat }
  }, [])

  // ── Material do corpo do líquido ──────────────────────────────────────────
  const bodyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uDye:    { value: dyeTargets[0].texture },
      uLiqBot: { value: LIQUID_BOT },
      uLiqH:   { value: LIQUID_H },
    },
    vertexShader:   BODY_VERT,
    fragmentShader: BODY_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
  }), [dyeTargets])

  // ── Material da superfície ────────────────────────────────────────────────
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uDye: { value: dyeTargets[0].texture },
    },
    vertexShader:   SURF_VERT,
    fragmentShader: SURF_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [dyeTargets])

  // ── Geometria polar da superfície ─────────────────────────────────────────
  const surfaceGeo = useMemo(() => {
    const rings = SURF_RINGS, segs = SURF_SEGS
    const vCount = 1 + rings * segs
    const pos = new Float32Array(vCount * 3)
    const nor = new Float32Array(vCount * 3)
    const uvs = new Float32Array(vCount * 2)
    const idx = []
    nor[1] = 1; uvs[0] = 0.5; uvs[1] = 0.5
    for (let ring = 0; ring < rings; ring++) {
      const r = LIQUID_R * (ring + 1) / rings
      for (let seg = 0; seg < segs; seg++) {
        const a = (seg / segs) * Math.PI * 2
        const i = 1 + ring * segs + seg
        pos[i*3] = Math.cos(a) * r; pos[i*3+1] = 0; pos[i*3+2] = Math.sin(a) * r
        nor[i*3+1] = 1
        uvs[i*2] = 0.5 + Math.cos(a) * 0.5 * (ring+1)/rings
        uvs[i*2+1] = 0.5 + Math.sin(a) * 0.5 * (ring+1)/rings
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1+s, 1+(s+1)%segs)
    for (let ring = 0; ring < rings-1; ring++) {
      for (let s = 0; s < segs; s++) {
        const a = 1+ring*segs+s, b = 1+ring*segs+(s+1)%segs
        const c = 1+(ring+1)*segs+s, d = 1+(ring+1)*segs+(s+1)%segs
        idx.push(a,c,b, b,c,d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3))
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(idx)
    return geo
  }, [])

  const vCount = useMemo(() => 1 + SURF_RINGS * SURF_SEGS, [])

  // ── Init height fields ────────────────────────────────────────────────────
  useEffect(() => {
    hCurrent.current = new Float32Array(vCount)
    hVel.current     = new Float32Array(vCount)
  }, [vCount])

  // ── Inicializa corante com COL_A no primeiro frame ────────────────────────
  useEffect(() => {
    const initScene = new THREE.Scene()
    const initCam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const initMat   = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: COL_A } },
      vertexShader:   `void main(){ gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor,1.0); }`,
      depthTest: false, depthWrite: false,
    })
    initScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), initMat))
    gl.setRenderTarget(dyeTargets[0]); gl.render(initScene, initCam)
    gl.setRenderTarget(dyeTargets[1]); gl.render(initScene, initCam)
    gl.setRenderTarget(null)
    bodyMat.uniforms.uDye.value = dyeTargets[0].texture
    surfMat.uniforms.uDye.value = dyeTargets[0].texture
    initMat.dispose()
  }, [gl, dyeTargets, bodyMat, surfMat])

  // ── Bolhas ────────────────────────────────────────────────────────────────
  const bubbles = useMemo(() => Array.from({ length: BUBBLE_COUNT }, () => {
    const a = Math.random() * Math.PI * 2
    return {
      x: Math.cos(a) * Math.random() * LIQUID_R * 0.75,
      z: Math.sin(a) * Math.random() * LIQUID_R * 0.75,
      y: LIQUID_BOT + Math.random() * LIQUID_H,
      speed: 0.18 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
    }
  }), [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const _col  = useMemo(() => new THREE.Color(), [])

  // ── useFrame ──────────────────────────────────────────────────────────────
  useFrame(({ gl: renderer }, delta) => {
    const dt = Math.min(delta, 0.05)
    if (runRef.current) timeRef.current += dt
    const t  = timeRef.current
    const k  = computeK(temperature)
    const X  = Math.min(0.9999, 1 - Math.exp(-k * t))
    const Ca = initialConc * (1 - X)

    if (domConv.current) domConv.current.textContent = `${(X*100).toFixed(1)} %`
    if (domCa.current)   domCa.current.textContent   = `CA = ${Ca.toFixed(3)} mol/L`
    if (domK.current)    domK.current.textContent     = `k = ${k.toFixed(4)} s⁻¹`

    if (agitatorRef.current && runRef.current) {
      agitatorRef.current.rotation.y += dt * agitatorSpeed
      agitAngle.current += dt * agitatorSpeed
    }

    // ── Dye advection (ping-pong, always runs) ───────────────────────────
    const dyeCur = dyeTargets[dyeIdx.current]
    const dyeNxt = dyeTargets[1 - dyeIdx.current]

    const adv = advObj.mat.uniforms
    adv.uDye.value       = dyeCur.texture
    adv.uDt.value        = dt
    adv.uAgitSpeed.value = agitatorSpeed
    adv.uTime.value      = t
    adv.uConv.value      = X

    renderer.setRenderTarget(dyeNxt)
    renderer.render(advObj.scene, advObj.camera)
    renderer.setRenderTarget(null)

    dyeIdx.current = 1 - dyeIdx.current
    bodyMat.uniforms.uDye.value = dyeNxt.texture
    surfMat.uniforms.uDye.value = dyeNxt.texture

    // ── CPU physics (4 passes) ───────────────────────────────────────────
    {
      const { pos: pPos, vel: pVel, dye: pDye, head: gHead, next: gNext } = pData
      const FILL_H = LIQUID_BOT + LIQUID_H * 0.70
      const effSpeed = runRef.current ? agitatorSpeed : 0

      // ── Pass 1: integrate forces + positions ───────────────────────────
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i*3, iy = i*3+1, iz = i*3+2
        let px = pPos[ix], py = pPos[iy], pz = pPos[iz]
        let vx = pVel[ix], vy = pVel[iy], vz = pVel[iz]

        // a) Reduced gravity (buoyancy ~97%)
        vy -= 9.8 * dt * 0.03

        // b) Hydrostatic pressure: upward force proportional to depth
        const depth = FILL_H - py
        if (depth > 0.0) {
          const depthNorm = depth / (LIQUID_H * 0.70)
          vy += depthNorm * 9.8 * dt * 0.08
        }

        // c) Rushton impeller forces (r < 0.80, |dy| < 0.45)
        const impR = Math.sqrt(px*px + pz*pz)
        const dyImp = py - (-0.62)
        if (impR < 0.80 && Math.abs(dyImp) < 0.45) {
          const ang = Math.atan2(pz, px)
          const tangSpeed = effSpeed * 1.2 * Math.max(0, 1.0 - impR / 0.80)
          vx += Math.cos(ang + Math.PI * 0.5) * tangSpeed * dt
          vz += Math.sin(ang + Math.PI * 0.5) * tangSpeed * dt
          vx += Math.cos(ang) * effSpeed * 0.5 * dt
          vz += Math.sin(ang) * effSpeed * 0.5 * dt
          const wb = impR / 0.80
          if (Math.abs(dyImp) < 0.08) {
            vy += effSpeed * 1.2 * dt
          } else if (dyImp > 0) {
            vy += effSpeed * (wb * 0.7 - (1 - wb) * 0.5) * dt
          } else {
            vy += effSpeed * ((1 - wb) * 0.5 - wb * 0.3) * dt
          }
        }

        // d) Cylinder boundary
        const rxy = Math.sqrt(px*px + pz*pz)
        const maxR = LIQUID_R - PARTICLE_R
        if (rxy > maxR) {
          const inv = 1.0 / Math.max(rxy, 0.0001)
          vx -= px * inv * 10.0 * dt
          vz -= pz * inv * 10.0 * dt
          const sc = maxR / rxy; px *= sc; pz *= sc
        }

        // e) Floor
        if (py < LIQUID_BOT + PARTICLE_R) {
          py = LIQUID_BOT + PARTICLE_R
          if (vy < 0) vy = -vy * 0.2
        }

        // f) Free surface
        if (py > FILL_H + PARTICLE_R) vy -= 20.0 * dt

        // g) Shaft collision (r < 0.04)
        const sr = Math.sqrt(px*px + pz*pz)
        const minSR = 0.04 + PARTICLE_R
        if (sr < minSR && sr > 0.001) {
          const sc = minSR / sr; px = px * sc; pz = pz * sc
          const nr = 1 / sr; const vnr = vx*px*nr + vz*pz*nr
          if (vnr < 0) { vx -= px*nr*vnr; vz -= pz*nr*vnr }
        }

        // h) Blade collision (3 Rushton blades: box 0.72×0.052×0.14)
        if (Math.abs(py - (-0.62)) < 0.026 + PARTICLE_R + 0.02) {
          for (let b = 0; b < 3; b++) {
            const theta = agitAngle.current + b * (Math.PI * 2 / 3)
            const cT = Math.cos(-theta), sT = Math.sin(-theta)
            const lx = px * cT - pz * sT
            const lz = px * sT + pz * cT
            const ly = py - (-0.62)
            const BL = 0.36 + PARTICLE_R, BH = 0.026 + PARTICLE_R, BW = 0.07 + PARTICLE_R
            if (Math.abs(lx) < BL && Math.abs(ly) < BH && Math.abs(lz) < BW) {
              const dPy = BH - Math.abs(ly), dPz = BW - Math.abs(lz), dPx = BL - Math.abs(lx)
              if (dPy <= dPz && dPy <= dPx) {
                const sY = Math.sign(ly) || 1
                if (vy * sY < 0) vy = Math.abs(vy) * 0.3 * sY
                py = -0.62 + BH * sY
              } else {
                const bladeVel = effSpeed * Math.abs(lx)
                vx += -Math.sin(theta) * bladeVel * 1.0
                vz +=  Math.cos(theta) * bladeVel * 1.0
              }
            }
          }
        }

        // i) Viscous damping
        vx *= Math.pow(0.85, dt * 60); vy *= Math.pow(0.88, dt * 60); vz *= Math.pow(0.85, dt * 60)

        // j) Integrate position
        px += vx * dt; py += vy * dt; pz += vz * dt

        pPos[ix] = px; pPos[iy] = py; pPos[iz] = pz
        pVel[ix] = vx; pVel[iy] = vy; pVel[iz] = vz

        // k) Dye advection
        pDye[i] += (X - pDye[i]) * (X * effSpeed * 0.005 + 0.0006)
      }

      // ── Pass 2: build spatial hash ─────────────────────────────────────
      gHead.fill(-1)
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const gx = Math.floor((pPos[i*3]   - G_OX) / G_CELL)
        const gy = Math.floor((pPos[i*3+1] - G_OY) / G_CELL)
        const gz = Math.floor((pPos[i*3+2] - G_OZ) / G_CELL)
        if (gx < 0 || gy < 0 || gz < 0 || gx >= G_NX || gy >= G_NY || gz >= G_NZ) continue
        const c = gx + gz * G_NX + gy * (G_NX * G_NZ)
        gNext[i] = gHead[c]; gHead[c] = i
      }

      // ── Pass 3: PBD collision resolution ──────────────────────────────
      const D2 = PARTICLE_D * PARTICLE_D
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i*3, iy = i*3+1, iz = i*3+2
        const gx0 = Math.floor((pPos[ix] - G_OX) / G_CELL)
        const gy0 = Math.floor((pPos[iy] - G_OY) / G_CELL)
        const gz0 = Math.floor((pPos[iz] - G_OZ) / G_CELL)
        for (let dgy = -1; dgy <= 1; dgy++) {
          const gy = gy0 + dgy; if (gy < 0 || gy >= G_NY) continue
          for (let dgz = -1; dgz <= 1; dgz++) {
            const gz = gz0 + dgz; if (gz < 0 || gz >= G_NZ) continue
            for (let dgx = -1; dgx <= 1; dgx++) {
              const gx = gx0 + dgx; if (gx < 0 || gx >= G_NX) continue
              let j = gHead[gx + gz * G_NX + gy * (G_NX * G_NZ)]
              while (j !== -1) {
                if (j > i) {
                  const jx=j*3, jy=j*3+1, jz=j*3+2
                  const dx=pPos[ix]-pPos[jx], dy=pPos[iy]-pPos[jy], dz=pPos[iz]-pPos[jz]
                  const d2 = dx*dx + dy*dy + dz*dz
                  if (d2 < D2 && d2 > 1e-10) {
                    const d = Math.sqrt(d2), ovl = (PARTICLE_D - d) * 0.5
                    const nx=dx/d, ny=dy/d, nz=dz/d
                    pPos[ix]+=nx*ovl; pPos[iy]+=ny*ovl; pPos[iz]+=nz*ovl
                    pPos[jx]-=nx*ovl; pPos[jy]-=ny*ovl; pPos[jz]-=nz*ovl
                    const dvn=(pVel[ix]-pVel[jx])*nx+(pVel[iy]-pVel[jy])*ny+(pVel[iz]-pVel[jz])*nz
                    if (dvn < 0) {
                      const imp = dvn * 0.15
                      pVel[ix]-=nx*imp; pVel[iy]-=ny*imp; pVel[iz]-=nz*imp
                      pVel[jx]+=nx*imp; pVel[jy]+=ny*imp; pVel[jz]+=nz*imp
                    }
                  }
                }
                j = gNext[j]
              }
            }
          }
        }
      }

      // ── Pass 4: write to BufferGeometry attributes ─────────────────────
      if (ptclGeoRef.current) {
        const posAttr = ptclGeoRef.current.geometry.attributes.position
        const colAttr = ptclGeoRef.current.geometry.attributes.color
        const BOT_R=0.04, BOT_G=0.10, BOT_B=0.23
        const MID_R=0.00, MID_G=0.33, MID_B=0.73
        const TOP_R=0.13, TOP_G=0.87, TOP_B=0.93
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix=i*3, iy=i*3+1, iz=i*3+2
          posAttr.array[ix] = pPos[ix]
          posAttr.array[iy] = pPos[iy]
          posAttr.array[iz] = pPos[iz]
          const hN = Math.max(0, Math.min(1, (pPos[iy] - LIQUID_BOT) / LIQUID_H))
          let r, g, b
          if (hN < 0.5) {
            r = BOT_R + (MID_R - BOT_R) * hN * 2
            g = BOT_G + (MID_G - BOT_G) * hN * 2
            b = BOT_B + (MID_B - BOT_B) * hN * 2
          } else {
            r = MID_R + (TOP_R - MID_R) * (hN - 0.5) * 2
            g = MID_G + (TOP_G - MID_G) * (hN - 0.5) * 2
            b = MID_B + (TOP_B - MID_B) * (hN - 0.5) * 2
          }
          const dv = pDye[i]
          let cr = r*(1-dv) + 1.0*dv
          let cg = g*(1-dv) + 0.27*dv
          let cb = b*(1-dv) + 0.0*dv
          const darken = 0.35 + 0.65 * hN
          colAttr.array[ix] = cr * darken
          colAttr.array[iy] = cg * darken
          colAttr.array[iz] = cb * darken
        }
        posAttr.needsUpdate = true
        colAttr.needsUpdate = true
      }
    }

    if (!runRef.current) return

    // ── Height field: vórtice ────────────────────────────────────────────
    const hC = hCurrent.current, hV = hVel.current
    if (!hC || !surfaceRef.current) return
    const pos = surfaceRef.current.geometry.attributes.position
    const vortexDepth = Math.min(agitatorSpeed * 0.30, 1.08)
    const sigma  = 0.14 + agitatorSpeed * 0.024
    const sigma2 = sigma * sigma

    for (let i = 0; i < vCount; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const r = Math.sqrt(x*x + z*z), θ = Math.atan2(z, x)
      const hF = -vortexDepth * Math.exp(-(r*r)/sigma2)
      const hS = agitatorSpeed * 0.07 * r * Math.exp(-r/(sigma*2.5)) *
                 Math.sin(θ - agitAngle.current * 1.6 + r * 7.0)
      const oF = Math.max(0, (r - sigma*2.5)) / Math.max(0.01, LIQUID_R - sigma*2.5)
      const hT = agitatorSpeed * 0.036 * oF * oF * (
        Math.sin(r*8.5 - t*3.8 + θ*2.0) * 0.5 +
        Math.sin(r*5.0 + t*2.4 - θ*1.3) * 0.35 +
        Math.cos(r*13  - t*5.1 + θ*3.5) * 0.15)
      const target = hF + hS + hT
      hV[i] += (target - hC[i]) * 8.5 * dt
      hV[i] *= Math.pow(0.78, dt*60)
      hC[i] += hV[i] * dt
      pos.setY(i, hC[i])
    }
    pos.needsUpdate = true
    surfaceRef.current.geometry.computeVertexNormals()

    // ── Bolhas ───────────────────────────────────────────────────────────
    const mesh = bubblesRef.current
    if (!mesh) return
    const liqColor = _col.clone().lerpColors(COL_A, COL_B, X)
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const b = bubbles[i]
      b.y += b.speed * dt * (0.4 + agitatorSpeed * 0.6)
      const wb = Math.sin(t*2.1 + b.phase) * 0.04
      if (b.y > LIQUID_TOP + 0.05) {
        b.y = LIQUID_BOT + Math.random() * 0.2
        const a = Math.random() * Math.PI * 2
        const r2 = Math.random() * LIQUID_R * 0.72
        b.x = Math.cos(a) * r2; b.z = Math.sin(a) * r2
      }
      dummy.position.set(b.x + Math.cos(b.phase+t)*wb, b.y, b.z + Math.sin(b.phase+t)*wb)
      dummy.scale.setScalar(b.y < LIQUID_TOP - 0.05 ? 1 : 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      _col.copy(liqColor).lerp(new THREE.Color('#ffffff'), 0.4)
      mesh.setColorAt(i, _col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <group>
      <pointLight position={[0, -0.62, 0]} intensity={1.0} distance={3.0} decay={2} color="#88ccff" />

      {/* ══ Vidro — renderOrder=3, depthWrite=false para não ocultar partículas ══ */}
      <mesh castShadow renderOrder={3}>
        <cylinderGeometry args={[1, 1, 3, 56, 1, true]} />
        <meshStandardMaterial color="#cce8f8" transparent opacity={0.13}
          roughness={0.02} metalness={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.5, 0]} renderOrder={3}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI*2, 0, Math.PI/2]} />
        <meshStandardMaterial color="#cce8f8" transparent opacity={0.13}
          roughness={0.02} metalness={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, -1.5, 0]} renderOrder={3}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI*2, Math.PI/2, Math.PI/2]} />
        <meshStandardMaterial color="#cce8f8" transparent opacity={0.13}
          roughness={0.02} metalness={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {[1.5,-1.5].map((y,i) => (
        <mesh key={i} position={[0,y,0]} rotation={[-Math.PI/2,0,0]}>
          <torusGeometry args={[1.02,0.046,10,48]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.15} />
        </mesh>
      ))}

      {showJacket && (<>
        <mesh>
          <cylinderGeometry args={[1.15,1.15,2.5,32,1,true]} />
          <meshStandardMaterial color="#EE7733" emissive="#cc5500" emissiveIntensity={0.18}
            transparent opacity={0.28} side={THREE.DoubleSide} />
        </mesh>
        {[1.25,-1.25].map((y,i) => (
          <mesh key={i} position={[0,y,0]} rotation={[-Math.PI/2,0,0]}>
            <torusGeometry args={[1.15,0.03,8,40]} />
            <meshStandardMaterial color="#cc5500" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
      </>)}

      {/* ══ Agitador ════════════════════════════════════════════════════════ */}
      <group ref={agitatorRef}>
        <mesh position={[0,0.575,0]}>
          <cylinderGeometry args={[0.040,0.040,2.35,8]} />
          <meshStandardMaterial color="#475569" metalness={0.82} roughness={0.18} />
        </mesh>
        <mesh position={[0,-0.62,0]}>
          <cylinderGeometry args={[0.09,0.09,0.12,16]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.22} />
        </mesh>
        {[0,1,2].map(i => (
          <mesh key={i} position={[0,-0.62,0]} rotation={[0,(i*Math.PI*2)/3,0]}>
            <boxGeometry args={[0.72,0.052,0.14]} />
            <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.28} />
          </mesh>
        ))}
      </group>

      {[[-1.22,1.05],[1.22,-1.05]].map(([x,y],i) => (
        <group key={i}>
          <mesh position={[x,y,0]} rotation={[0,0,Math.PI/2]}>
            <cylinderGeometry args={[0.07,0.07,0.44,12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.72} roughness={0.28} />
          </mesh>
          <mesh position={[x<0?-1.44:1.44,y,0]} rotation={[0,0,Math.PI/2]}>
            <torusGeometry args={[0.09,0.022,8,24]} />
            <meshStandardMaterial color="#b0bec5" metalness={0.85} roughness={0.15} />
          </mesh>
        </group>
      ))}

      {/* ══ PARTÍCULAS — sphere impostors (CPU PBD physics + gl_FragDepth) ════ */}
      <points ref={ptclGeoRef} geometry={ptclGeo} material={ptclMat}
              frustumCulled={false} renderOrder={1} />

      {/* ══ SUPERFÍCIE animada (height-field + vórtice + shader corante) ════ */}
      <mesh ref={surfaceRef} position={[0, LIQUID_TOP, 0]}
            geometry={surfaceGeo} material={surfMat} renderOrder={4} />

      {/* ══ Bolhas ══════════════════════════════════════════════════════════ */}
      <instancedMesh ref={bubblesRef} args={[undefined,undefined,BUBBLE_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[BUBBLE_R,6,6]} />
        <meshStandardMaterial vertexColors transparent opacity={0.55}
          roughness={0.05} metalness={0.1} />
      </instancedMesh>

      {/* ══ Overlay ═════════════════════════════════════════════════════════ */}
      <Html position={[1.82,0.55,0]} center>
        <div style={{background:'rgba(10,14,26,0.88)',color:'#f8fafc',
          padding:'11px 16px',borderRadius:9,fontSize:12,fontWeight:700,
          border:'1px solid rgba(255,255,255,0.13)',minWidth:148,
          pointerEvents:'none',lineHeight:1.75,
          boxShadow:'0 4px 16px rgba(0,0,0,0.48)',userSelect:'none',whiteSpace:'nowrap'}}>
          <div style={{color:'#33BBEE',fontSize:9.5,letterSpacing:0.7,marginBottom:5,textTransform:'uppercase'}}>
            ⚗️ Reator Batelada</div>
          <div style={{fontSize:22,fontWeight:800,color:'#EE7733',lineHeight:1.2}}>
            <span ref={domConv}>0.0 %</span></div>
          <div style={{fontSize:10,color:'rgba(248,250,252,0.6)',marginBottom:4}}>Conversão X</div>
          <div ref={domCa} style={{color:'#f8fafc',fontSize:11}}>CA = {initialConc.toFixed(3)} mol/L</div>
          <div ref={domK}  style={{color:'rgba(248,250,252,0.55)',fontSize:10}}>k = 0.0000 s⁻¹</div>
          <div style={{color:'rgba(248,250,252,0.55)',fontSize:10}}>T = {temperature} K</div>
        </div>
      </Html>
    </group>
  )
}
