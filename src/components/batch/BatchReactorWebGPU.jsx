import { useEffect, useRef, useState } from 'react'
import { mat4 } from 'wgpu-matrix'
import {
  IMPELLER_H,
  IMPELLER_R,
  IMPELLER_Y,
  PARTICLE_RENDER_SIZE,
  REACTOR_TOP,
  ReactorSPH,
  SHAFT_R,
} from './sph/ReactorSPH'
import sphereShader from './sph/sphere.wgsl?raw'
import geometryShader from './webgpu/shaders/geometry.wgsl?raw'
import { ReactorFluidRenderer } from './render/ReactorFluidRenderer.js'

const NUM_PARTICLES = 55000
const FOV = (50 * Math.PI) / 180
const CAMERA_TARGET = [0, -0.5, 0]
const INITIAL_DISTANCE = Math.hypot(4, 2.5, 5)
const INITIAL_YAW = Math.atan2(5, 4)
const INITIAL_PITCH = Math.asin(2.5 / INITIAL_DISTANCE)

const GLASS_RADIUS = 1.0
const GLASS_BOTTOM = -1.45
const GLASS_TOP = 0.75
const JACKET_RADIUS = 1.15
const JACKET_BOTTOM = -1.25
const JACKET_TOP = 0.65

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function createSphereUniformViews(buffer) {
  return {
    texelSize:     new Float32Array(buffer, 0,   2),
    sphereSize:    new Float32Array(buffer, 8,   2),
    invProjection: new Float32Array(buffer, 16,  16),
    projection:    new Float32Array(buffer, 80,  16),
    view:          new Float32Array(buffer, 144, 16),
    invView:       new Float32Array(buffer, 208, 16),
    // New fields at offset 272 (288-byte buffer)
    colorMode:     new Uint32Array (buffer, 272, 1),
    temperature:   new Float32Array(buffer, 276, 1),
    mixedness:     new Float32Array(buffer, 280, 1),
  }
}

function writeGeometryUniform(device, buffer, projection, view, model, color, cameraPos, isGlass, temperature = 25) {
  const data = new ArrayBuffer(240)
  const f32 = new Float32Array(data)
  const u32 = new Uint32Array(data)
  f32.set(projection, 0)
  f32.set(view, 16)
  f32.set(model, 32)
  f32.set(color, 48)
  f32.set(cameraPos, 52)
  u32[55] = isGlass ? 1 : 0
  f32[56] = temperature          // offset 224 = index 56 × 4 bytes
  device.queue.writeBuffer(buffer, 0, data)
}

function appendVertex(vertices, position, normal) {
  vertices.push(position[0], position[1], position[2], normal[0], normal[1], normal[2])
}

function appendCylinderWall(vertices, indices, radius, bottom, top, segments, inward = false) {
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    const n0 = inward ? [-c0, 0, -s0] : [c0, 0, s0]
    const n1 = inward ? [-c1, 0, -s1] : [c1, 0, s1]
    const base = vertices.length / 6

    appendVertex(vertices, [radius * c0, bottom, radius * s0], n0)
    appendVertex(vertices, [radius * c1, bottom, radius * s1], n1)
    appendVertex(vertices, [radius * c1, top, radius * s1], n1)
    appendVertex(vertices, [radius * c0, top, radius * s0], n0)

    if (inward) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
}

function appendCylinder(vertices, indices, radius, bottom, top, segments) {
  appendCylinderWall(vertices, indices, radius, bottom, top, segments, false)

  const topCenter = vertices.length / 6
  appendVertex(vertices, [0, top, 0], [0, 1, 0])
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    appendVertex(vertices, [Math.cos(angle) * radius, top, Math.sin(angle) * radius], [0, 1, 0])
  }
  for (let i = 0; i < segments; i += 1) {
    const next = ((i + 1) % segments) + 1
    indices.push(topCenter, topCenter + i + 1, topCenter + next)
  }

  const bottomCenter = vertices.length / 6
  appendVertex(vertices, [0, bottom, 0], [0, -1, 0])
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    appendVertex(vertices, [Math.cos(angle) * radius, bottom, Math.sin(angle) * radius], [0, -1, 0])
  }
  for (let i = 0; i < segments; i += 1) {
    const next = ((i + 1) % segments) + 1
    indices.push(bottomCenter, bottomCenter + next, bottomCenter + i + 1)
  }
}

function rotateY(position, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [position[0] * c - position[2] * s, position[1], position[0] * s + position[2] * c]
}

function appendBox(vertices, indices, center, size, angle = 0) {
  const [sx, sy, sz] = size
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ]
  const faces = [
    { normal: [0, 0, 1], corners: [4, 5, 6, 7] },
    { normal: [0, 0, -1], corners: [1, 0, 3, 2] },
    { normal: [1, 0, 0], corners: [5, 1, 2, 6] },
    { normal: [-1, 0, 0], corners: [0, 4, 7, 3] },
    { normal: [0, 1, 0], corners: [7, 6, 2, 3] },
    { normal: [0, -1, 0], corners: [0, 1, 5, 4] },
  ]

  for (const face of faces) {
    const base = vertices.length / 6
    const normal = rotateY(face.normal, angle)
    for (const cornerIndex of face.corners) {
      const rotated = rotateY(corners[cornerIndex], angle)
      appendVertex(
        vertices,
        [rotated[0] + center[0], rotated[1] + center[1], rotated[2] + center[2]],
        normal,
      )
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

function createMeshData(buildFn) {
  const vertices = []
  const indices = []
  buildFn(vertices, indices)
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  }
}

function createMeshBuffers(device, data) {
  const vertexBuffer = device.createBuffer({
    size: data.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const indexBuffer = device.createBuffer({
    size: data.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertexBuffer, 0, data.vertices)
  device.queue.writeBuffer(indexBuffer, 0, data.indices)
  return {
    vertexBuffer,
    indexBuffer,
    indexCount: data.indices.length,
  }
}

function buildImpellerData() {
  return createMeshData((vertices, indices) => {
    appendCylinder(vertices, indices, SHAFT_R, IMPELLER_Y - 0.08, REACTOR_TOP + 0.55, 20)
    appendCylinder(vertices, indices, 0.09, IMPELLER_Y - 0.06, IMPELLER_Y + 0.06, 24)
    for (let i = 0; i < 6; i += 1) {
      const angle = (i * Math.PI) / 3
      const center = [Math.cos(angle) * (IMPELLER_R * 0.5), IMPELLER_Y, Math.sin(angle) * (IMPELLER_R * 0.5)]
      appendBox(vertices, indices, center, [IMPELLER_R * 0.55, IMPELLER_H, 0.12], angle)
    }
  })
}

function buildCylinderWallData(radius, bottom, top, segments, inward = false) {
  return createMeshData((vertices, indices) => {
    appendCylinderWall(vertices, indices, radius, bottom, top, segments, inward)
  })
}

export default function BatchReactorWebGPU({ isRunning, params, onKineticsUpdate, showFluid = false, temperature = 25, colorMode = 0, onMixingUpdate }) {
  const canvasRef = useRef(null)
  const paramsRef = useRef(params)
  const isRunningRef = useRef(isRunning)
  const onKineticsUpdateRef = useRef(onKineticsUpdate)
  const showFluidRef = useRef(showFluid)
  const temperatureRef = useRef(temperature)
  const colorModeRef = useRef(colorMode)
  const mixednessRef = useRef(0)
  const onMixingUpdateRef = useRef(onMixingUpdate)
  const [message, setMessage] = useState('')

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    onKineticsUpdateRef.current = onKineticsUpdate
  }, [onKineticsUpdate])

  useEffect(() => {
    showFluidRef.current = showFluid
  }, [showFluid])

  useEffect(() => {
    temperatureRef.current = temperature
  }, [temperature])

  useEffect(() => {
    colorModeRef.current = colorMode
  }, [colorMode])

  useEffect(() => {
    onMixingUpdateRef.current = onMixingUpdate
  }, [onMixingUpdate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let destroyed = false
    let depthTexture = null
    let fluidRenderer = null
    let animationFrameId = 0
    let sph = null
    let removeEvents = () => {}

    const init = async () => {
      try {
        if (!navigator.gpu) {
          setMessage('WebGPU não está disponível neste navegador.')
          return
        }

        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) {
          setMessage('Não foi possível obter um adaptador WebGPU.')
          return
        }

        const device = await adapter.requestDevice()
        if (destroyed) return

        const context = canvas.getContext('webgpu')
        if (!context) {
          setMessage('Falha ao criar o contexto WebGPU.')
          return
        }

        const format = navigator.gpu.getPreferredCanvasFormat()
        context.configure({
          device,
          format,
          alphaMode: 'opaque',
        })

        sph = new ReactorSPH(device, NUM_PARTICLES)
        await sph.init(paramsRef.current.agitatorSpeed ?? 0)
        if (destroyed) {
          sph.destroy()
          return
        }

        const sphereModule = device.createShaderModule({ code: sphereShader })
        const geometryModule = device.createShaderModule({ code: geometryShader })

        const sphereUniformData = new ArrayBuffer(288)
        const sphereUniformViews = createSphereUniformViews(sphereUniformData)
        const sphereUniformBuffer = device.createBuffer({
          size: sphereUniformData.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })

        fluidRenderer = new ReactorFluidRenderer(
          device, canvas, format,
          sph.kernelRadius,
          FOV,
          sph.posvelBuffer,
          sphereUniformBuffer,
        )

        const geometryUniformLayout = {
          size: 240,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }
        const impellerUniformBuffer = device.createBuffer(geometryUniformLayout)
        const glassUniformBuffer = device.createBuffer(geometryUniformLayout)
        const jacketUniformBuffer = device.createBuffer(geometryUniformLayout)

        const spherePipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: sphereModule,
            entryPoint: 'vs',
          },
          fragment: {
            module: sphereModule,
            entryPoint: 'fs',
            targets: [{ format }],
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'none',
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
          },
        })

        const vertexLayout = {
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }

        const opaquePipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: geometryModule,
            entryPoint: 'vs',
            buffers: [vertexLayout],
          },
          fragment: {
            module: geometryModule,
            entryPoint: 'fs',
            targets: [{ format }],
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'none',
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
          },
        })

        const transparentPipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: geometryModule,
            entryPoint: 'vs',
            buffers: [vertexLayout],
          },
          fragment: {
            module: geometryModule,
            entryPoint: 'fs',
            targets: [{
              format,
              blend: {
                color: {
                  srcFactor: 'src-alpha',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add',
                },
                alpha: {
                  srcFactor: 'one',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add',
                },
              },
            }],
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'none',
          },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: false,
            depthCompare: 'less',
          },
        })

        const sphereBindGroup = device.createBindGroup({
          layout: spherePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sph.posvelBuffer } },
            { binding: 1, resource: { buffer: sphereUniformBuffer } },
          ],
        })
        const impellerBindGroup = device.createBindGroup({
          layout: opaquePipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: impellerUniformBuffer } }],
        })
        const jacketBindGroup = device.createBindGroup({
          layout: opaquePipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: jacketUniformBuffer } }],
        })
        const glassBindGroup = device.createBindGroup({
          layout: transparentPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: glassUniformBuffer } }],
        })

        const impellerMesh = createMeshBuffers(device, buildImpellerData())
        const glassMesh = createMeshBuffers(device, buildCylinderWallData(GLASS_RADIUS, GLASS_BOTTOM, GLASS_TOP, 64, true))
        const jacketMesh = createMeshBuffers(device, buildCylinderWallData(JACKET_RADIUS, JACKET_BOTTOM, JACKET_TOP, 64, false))

        const camera = {
          yaw: INITIAL_YAW,
          pitch: INITIAL_PITCH,
          distance: INITIAL_DISTANCE,
          dragging: false,
          lastX: 0,
          lastY: 0,
        }

        const handleMouseDown = event => {
          if (event.button !== 0) return
          camera.dragging = true
          camera.lastX = event.clientX
          camera.lastY = event.clientY
        }
        const handleMouseMove = event => {
          if (!camera.dragging) return
          const dx = event.clientX - camera.lastX
          const dy = event.clientY - camera.lastY
          camera.lastX = event.clientX
          camera.lastY = event.clientY
          camera.yaw -= dx * 0.005
          camera.pitch = clamp(camera.pitch - dy * 0.005, -1.3, 1.1)
        }
        const handleMouseUp = () => {
          camera.dragging = false
        }
        const handleWheel = event => {
          event.preventDefault()
          camera.distance = clamp(camera.distance + Math.sign(event.deltaY) * 0.35, 2.5, 12)
        }

        canvas.addEventListener('mousedown', handleMouseDown)
        canvas.addEventListener('wheel', handleWheel, { passive: false })
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        removeEvents = () => {
          canvas.removeEventListener('mousedown', handleMouseDown)
          canvas.removeEventListener('wheel', handleWheel)
          window.removeEventListener('mousemove', handleMouseMove)
          window.removeEventListener('mouseup', handleMouseUp)
        }

        let lastTime = 0
        let agitAngle = 0
        let simTime = 0
        let smoothedSpeed = 0
        // Track last Ca0 and T so we can reset simTime when they change
        let lastCa0 = null
        let lastT   = null
        // Matrices persisted so the foam pass can use them each frame
        let lastProjection = new Float32Array(16)
        let lastView       = new Float32Array(16)

        const updateUniforms = (width, height) => {
          const projection = mat4.perspective(FOV, width / height, 0.1, 100)
          const eye = [
            CAMERA_TARGET[0] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
            CAMERA_TARGET[1] + camera.distance * Math.sin(camera.pitch),
            CAMERA_TARGET[2] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
          ]
          const view = mat4.lookAt(eye, CAMERA_TARGET, [0, 1, 0])

          // Persist for the foam pass
          lastProjection = projection
          lastView       = view

          sphereUniformViews.texelSize.set([1 / width, 1 / height])
          sphereUniformViews.sphereSize[0] = PARTICLE_RENDER_SIZE
          sphereUniformViews.sphereSize[1] = 0
          sphereUniformViews.invProjection.set(mat4.inverse(projection))
          sphereUniformViews.projection.set(projection)
          sphereUniformViews.view.set(view)
          sphereUniformViews.invView.set(mat4.inverse(view))
          // New per-frame fields
          sphereUniformViews.colorMode[0]   = colorModeRef.current
          sphereUniformViews.temperature[0] = temperatureRef.current
          sphereUniformViews.mixedness[0]   = mixednessRef.current
          device.queue.writeBuffer(sphereUniformBuffer, 0, sphereUniformData)

          const impellerModel = mat4.identity()
          mat4.rotateY(impellerModel, agitAngle, impellerModel)
          const identity = mat4.identity()

          const jacketTemp = temperatureRef.current
          writeGeometryUniform(device, impellerUniformBuffer, projection, view, impellerModel, [0.28, 0.33, 0.4, 1], eye, false, jacketTemp)
          writeGeometryUniform(device, jacketUniformBuffer,   projection, view, identity,      [0.93, 0.47, 0.2, 1], eye, false, jacketTemp)
          writeGeometryUniform(device, glassUniformBuffer,    projection, view, identity,      [0.78, 0.88, 0.98, 1], eye, true,  jacketTemp)
        }

        const frame = timestamp => {
          if (destroyed) return

          const dt = lastTime === 0 ? 1 / 60 : Math.min((timestamp - lastTime) / 1000, 0.05)
          lastTime = timestamp

          const targetSpeed = isRunningRef.current ? (paramsRef.current.agitatorSpeed ?? 0) : 0
          // Lerp smoothedSpeed toward target — responds at ~20% per frame
          const lerpRate = 1.0 - Math.pow(0.80, dt * 60)
          smoothedSpeed += (targetSpeed - smoothedSpeed) * lerpRate

          const T   = paramsRef.current.temperature || 350
          const Ca0 = paramsRef.current.initialConc || 1.0

          // Reset reaction clock when initial conditions change
          if (lastCa0 !== null && (Ca0 !== lastCa0 || T !== lastT)) {
            simTime = 0
            mixednessRef.current = 0
          }
          lastCa0 = Ca0
          lastT   = T

          if (isRunningRef.current) {
            agitAngle += smoothedSpeed * dt * 2
            // Simulation time scale: 1 real second = 8 sim seconds
            // Half-life at 350K (k≈0.0052/s) ≈ t½/8 ≈ 17s real time — visible
            simTime += dt * 8

            // ── Feature 4: mixing index (exponential approach to 1) ──────────
            const mixRate = smoothedSpeed * 0.12
            mixednessRef.current += mixRate * dt * (1 - mixednessRef.current)
            mixednessRef.current = Math.min(mixednessRef.current, 1.0)
            onMixingUpdateRef.current?.(mixednessRef.current)
          }

          sph.updateImpeller(smoothedSpeed, isRunningRef.current)

          const k  = 0.1 * Math.exp(-5000 * (1 / T - 1 / 350))
          const Ca = Ca0 * Math.exp(-k * simTime)
          const X  = 1 - Ca / Ca0
          onKineticsUpdateRef.current?.({
            Ca: Math.max(0, Ca),
            X: clamp(X, 0, 1),
            k,
            T,
          })

          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
          const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio))
          const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio))
          if (!depthTexture || canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
            depthTexture?.destroy()
            depthTexture = device.createTexture({
              size: [width, height],
              format: 'depth24plus',
              usage: GPUTextureUsage.RENDER_ATTACHMENT,
            })
            fluidRenderer.resize(canvas)
          }

          updateUniforms(width, height)

          const encoder = device.createCommandEncoder()
          if (isRunningRef.current) {
            // Extra substeps when speed is changing — converges faster
            const speedDelta = Math.abs(targetSpeed - smoothedSpeed)
            const substeps = speedDelta > 0.5 ? 4 : 2
            for (let s = 0; s < substeps; s++) sph.step(encoder)
          }

          if (showFluidRef.current) {
            // Fluid mode: run all fluid surface passes + foam overlay
            fluidRenderer.setAgitationSpeed(smoothedSpeed)
            fluidRenderer.execute(encoder, context, NUM_PARTICLES, lastProjection, lastView)

            // Draw geometry on top of the fluid surface (load to preserve fluid output)
            const pass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'load',
                storeOp: 'store',
              }],
              depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
              },
            })

            if (paramsRef.current.showJacket) {
              pass.setPipeline(opaquePipeline)
              pass.setBindGroup(0, jacketBindGroup)
              pass.setVertexBuffer(0, jacketMesh.vertexBuffer)
              pass.setIndexBuffer(jacketMesh.indexBuffer, 'uint32')
              pass.drawIndexed(jacketMesh.indexCount)
            }

            pass.setPipeline(opaquePipeline)
            pass.setBindGroup(0, impellerBindGroup)
            pass.setVertexBuffer(0, impellerMesh.vertexBuffer)
            pass.setIndexBuffer(impellerMesh.indexBuffer, 'uint32')
            pass.drawIndexed(impellerMesh.indexCount)

            pass.setPipeline(transparentPipeline)
            pass.setBindGroup(0, glassBindGroup)
            pass.setVertexBuffer(0, glassMesh.vertexBuffer)
            pass.setIndexBuffer(glassMesh.indexBuffer, 'uint32')
            pass.drawIndexed(glassMesh.indexCount)

            pass.end()
          } else {
            // Particles mode: standard sphere impostor rendering
            const pass = encoder.beginRenderPass({
              colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.86, g: 0.93, b: 1, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              }],
              depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
              },
            })

            if (paramsRef.current.showJacket) {
              pass.setPipeline(opaquePipeline)
              pass.setBindGroup(0, jacketBindGroup)
              pass.setVertexBuffer(0, jacketMesh.vertexBuffer)
              pass.setIndexBuffer(jacketMesh.indexBuffer, 'uint32')
              pass.drawIndexed(jacketMesh.indexCount)
            }

            pass.setPipeline(opaquePipeline)
            pass.setBindGroup(0, impellerBindGroup)
            pass.setVertexBuffer(0, impellerMesh.vertexBuffer)
            pass.setIndexBuffer(impellerMesh.indexBuffer, 'uint32')
            pass.drawIndexed(impellerMesh.indexCount)

            pass.setPipeline(spherePipeline)
            pass.setBindGroup(0, sphereBindGroup)
            pass.draw(6, NUM_PARTICLES)

            pass.setPipeline(transparentPipeline)
            pass.setBindGroup(0, glassBindGroup)
            pass.setVertexBuffer(0, glassMesh.vertexBuffer)
            pass.setIndexBuffer(glassMesh.indexBuffer, 'uint32')
            pass.drawIndexed(glassMesh.indexCount)

            pass.end()
          }
          device.queue.submit([encoder.finish()])
          animationFrameId = requestAnimationFrame(frame)
        }

        animationFrameId = requestAnimationFrame(frame)
      } catch (error) {
        console.error(error)
        if (!destroyed) {
          setMessage(error instanceof Error ? error.message : 'Falha ao inicializar WebGPU.')
        }
      }
    }

    init()

    return () => {
      destroyed = true
      cancelAnimationFrame(animationFrameId)
      removeEvents()
      depthTexture?.destroy()
      fluidRenderer?.destroy()
      sph?.destroy()
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        aria-label="Simulação 3D do reator batelada em WebGPU"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {message ? (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: '#0f172a',
          fontWeight: 700,
          background: 'rgba(255,255,255,0.6)',
          padding: 24,
          textAlign: 'center',
        }}>
          {message}
        </div>
      ) : null}
    </div>
  )
}
