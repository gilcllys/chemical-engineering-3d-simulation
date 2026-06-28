import { useEffect, useRef } from 'react'
import { mat4 } from 'wgpu-matrix'
import {
  CycloneParticles,
  CYCLONE_R, CYCLONE_HC, CYCLONE_HZ,
  VORTEX_R, VORTEX_L,
} from './webgpu/CycloneParticles'
import particleShader from './webgpu/shaders/cycloneParticle.wgsl?raw'
import geometryShader from './webgpu/shaders/cycloneGeometry.wgsl?raw'

const FOV           = (50 * Math.PI) / 180
const CAMERA_TARGET = [0, 0.5, 0]

// ── Geometry helpers ──────────────────────────────────────────────────────

function appendVertex(vertices, position, normal) {
  vertices.push(position[0], position[1], position[2], normal[0], normal[1], normal[2])
}

function appendCylinderWall(vertices, indices, radius, bottom, top, segments, inward = false) {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const [c0, s0] = [Math.cos(a0), Math.sin(a0)]
    const [c1, s1] = [Math.cos(a1), Math.sin(a1)]
    const n0 = inward ? [-c0, 0, -s0] : [c0, 0, s0]
    const n1 = inward ? [-c1, 0, -s1] : [c1, 0, s1]
    const base = vertices.length / 6
    appendVertex(vertices, [radius * c0, bottom, radius * s0], n0)
    appendVertex(vertices, [radius * c1, bottom, radius * s1], n1)
    appendVertex(vertices, [radius * c1, top,    radius * s1], n1)
    appendVertex(vertices, [radius * c0, top,    radius * s0], n0)
    if (inward) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
}

// Tapered frustum (cone) from topR at Y=top to botR at Y=bottom
function appendFrustumWall(vertices, indices, topR, botR, bottom, top, segments, inward = false) {
  const slant = Math.atan2(topR - botR, top - bottom)
  const ny = Math.sin(slant)
  const nr = Math.cos(slant)
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const [c0, s0] = [Math.cos(a0), Math.sin(a0)]
    const [c1, s1] = [Math.cos(a1), Math.sin(a1)]
    const base = vertices.length / 6
    appendVertex(vertices, [topR * c0, top,    topR * s0], [nr * c0, ny, nr * s0])
    appendVertex(vertices, [topR * c1, top,    topR * s1], [nr * c1, ny, nr * s1])
    appendVertex(vertices, [botR * c1, bottom, botR * s1], [nr * c1, ny, nr * s1])
    appendVertex(vertices, [botR * c0, bottom, botR * s0], [nr * c0, ny, nr * s0])
    if (inward) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
}

// Filled circle disk (facing up or down)
function appendDisk(vertices, indices, r, y, normalY, segments) {
  const center = vertices.length / 6
  appendVertex(vertices, [0, y, 0], [0, normalY, 0])
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    appendVertex(vertices, [Math.cos(a) * r, y, Math.sin(a) * r], [0, normalY, 0])
  }
  for (let i = 0; i < segments; i++) {
    if (normalY > 0) indices.push(center, center + i + 1, center + i + 2)
    else             indices.push(center, center + i + 2, center + i + 1)
  }
}

// Annular ring (e.g. top of cylinder with vortex-finder hole)
function appendRing(vertices, indices, innerR, outerR, y, normalY, segments) {
  const base = vertices.length / 6
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    appendVertex(vertices, [innerR * c, y, innerR * s], [0, normalY, 0])
    appendVertex(vertices, [outerR * c, y, outerR * s], [0, normalY, 0])
  }
  for (let i = 0; i < segments; i++) {
    const b = base + i * 2
    if (normalY > 0) {
      indices.push(b, b + 1, b + 3, b, b + 3, b + 2)
    } else {
      indices.push(b, b + 3, b + 1, b, b + 2, b + 3)
    }
  }
}

function buildMesh(device, verts, idxs) {
  const vb = device.createBuffer({
    size: verts.length * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vb, 0, new Float32Array(verts))
  const ib = device.createBuffer({
    size: idxs.length * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(ib, 0, new Uint32Array(idxs))
  return { vertexBuffer: vb, indexBuffer: ib, indexCount: idxs.length }
}

function buildCycloneMeshes(device) {
  const SEGS = 32

  // Main cylinder body
  const cylV = [], cylI = []
  appendCylinderWall(cylV, cylI, CYCLONE_R, 0, CYCLONE_HC, SEGS, false)
  appendRing(cylV, cylI, VORTEX_R, CYCLONE_R, CYCLONE_HC, 1, SEGS)

  // Cone body (tapers from R at y=0 down to small tip at y=-HZ)
  const coneV = [], coneI = []
  appendFrustumWall(coneV, coneI, CYCLONE_R, 0.08, -CYCLONE_HZ, 0, SEGS, false)
  appendDisk(coneV, coneI, 0.08, -CYCLONE_HZ, -1, 12)

  // Vortex finder tube (overflow pipe)
  const vfV = [], vfI = []
  const vfBottom = CYCLONE_HC - VORTEX_L
  appendCylinderWall(vfV, vfI, VORTEX_R, vfBottom, CYCLONE_HC + 0.5, 24, false)
  appendDisk(vfV, vfI, VORTEX_R, vfBottom, -1, 24)

  return {
    cylinder:     buildMesh(device, cylV,  cylI),
    cone:         buildMesh(device, coneV, coneI),
    vortexFinder: buildMesh(device, vfV,   vfI),
  }
}

// Write geometry uniform — exactly 224 bytes
// layout: projection(64) view(64) model(64) color(16) cameraPos(12) _pad(4)
function writeGeomUniform(device, buffer, projection, view, model, color, cameraPos) {
  const data = new ArrayBuffer(224)
  const f32  = new Float32Array(data)
  // projection: f32[0..15]  → byte offset 0
  f32.set(projection, 0)
  // view: f32[16..31]       → byte offset 64
  f32.set(view,       16)
  // model: f32[32..47]      → byte offset 128
  f32.set(model,      32)
  // color: f32[48..51]      → byte offset 192
  f32.set(color,      48)
  // cameraPos: f32[52..54]  → byte offset 208
  f32.set(cameraPos,  52)
  // f32[55] = _pad          → byte offset 220 (already zero)
  device.queue.writeBuffer(buffer, 0, data)
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CycloneWebGPU({ isRunning, params, onStatsUpdate }) {
  const canvasRef    = useRef(null)
  const isRunningRef = useRef(isRunning)
  const paramsRef    = useRef(params)

  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])
  useEffect(() => { paramsRef.current    = params    }, [params])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let destroyed = false
    let animId    = null

    ;(async () => {
      // ── WebGPU init ────────────────────────────────────────────────────
      if (!navigator.gpu) {
        console.error('[CycloneWebGPU] WebGPU not supported in this browser.')
        return
      }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        console.error('[CycloneWebGPU] No WebGPU adapter found.')
        return
      }
      const device = await adapter.requestDevice()
      if (destroyed) return

      const context = canvas.getContext('webgpu')
      const format  = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'opaque' })

      // ── Particle system ────────────────────────────────────────────────
      const cyclone = new CycloneParticles(device, paramsRef.current.particleCount ?? 3000)
      await cyclone.init(paramsRef.current.inletVelocity ?? 15)

      // ── Particle render uniform buffer (272 bytes) ────────────────────
      const particleUniformData = new ArrayBuffer(272)
      const particleUV = {
        texelSize:      new Float32Array(particleUniformData, 0,    2),
        sphereSizeBase: new Float32Array(particleUniformData, 8,    1),
        // _pad at byte 12 — skipped
        invProj:        new Float32Array(particleUniformData, 16,  16),
        proj:           new Float32Array(particleUniformData, 80,  16),
        view:           new Float32Array(particleUniformData, 144, 16),
        invView:        new Float32Array(particleUniformData, 208, 16),
      }
      const particleUniformBuf = device.createBuffer({
        size: 272,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      // ── Particle render pipeline ───────────────────────────────────────
      const particleModule   = device.createShaderModule({ code: particleShader })
      const particlePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: particleModule, entryPoint: 'vs' },
        fragment: {
          module:     particleModule,
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: { operation: 'add', srcFactor: 'src-alpha',   dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'one',         dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive:    { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
      })
      const particleBindGroup = device.createBindGroup({
        layout: particlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: cyclone.particleBuffer } },
          { binding: 1, resource: { buffer: particleUniformBuf } },
        ],
      })

      // ── Geometry shader module ─────────────────────────────────────────
      const geomModule = device.createShaderModule({ code: geometryShader })

      const vtxLayout = {
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0,  format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }

      // Opaque pipeline (depth write on — for vortex finder)
      const opaquePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: geomModule, entryPoint: 'vs', buffers: [vtxLayout] },
        fragment: { module: geomModule, entryPoint: 'fs', targets: [{ format }] },
        primitive:    { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
      })

      // Transparent pipeline (depth write off — for glass walls)
      const transparentPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: geomModule, entryPoint: 'vs', buffers: [vtxLayout] },
        fragment: {
          module:     geomModule,
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'one',       dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive:    { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
      })

      // ── Geometry uniform buffers (224 bytes each) ─────────────────────
      const makeGeomBuf = () => device.createBuffer({
        size: 224,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const cylinderUniformBuf     = makeGeomBuf()
      const coneUniformBuf         = makeGeomBuf()
      const vortexFinderUniformBuf = makeGeomBuf()

      const makeGeomBG = (buf, pipeline) => device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: buf } }],
      })
      const cylinderBG     = makeGeomBG(cylinderUniformBuf,     transparentPipeline)
      const coneBG         = makeGeomBG(coneUniformBuf,         transparentPipeline)
      const vortexFinderBG = makeGeomBG(vortexFinderUniformBuf, opaquePipeline)

      // ── Build meshes ──────────────────────────────────────────────────
      const meshes = buildCycloneMeshes(device)

      // ── Camera state ──────────────────────────────────────────────────
      const camera = {
        yaw:      Math.atan2(7, 5),
        pitch:    Math.asin(2.5 / Math.hypot(5, 2.5, 7)),
        distance: Math.hypot(5, 2.5, 7),
      }

      // Mouse / wheel interaction
      let dragging = false, lastX = 0, lastY = 0
      const onMouseDown = e => { dragging = true;  lastX = e.clientX; lastY = e.clientY }
      const onMouseUp   = ()  => { dragging = false }
      const onMouseMove = e  => {
        if (!dragging) return
        camera.yaw   -= (e.clientX - lastX) * 0.005
        camera.pitch  = Math.max(-1.3, Math.min(1.3, camera.pitch - (e.clientY - lastY) * 0.005))
        lastX = e.clientX; lastY = e.clientY
      }
      const onWheel = e => {
        e.preventDefault()
        camera.distance = Math.max(2, Math.min(25, camera.distance * (1 + e.deltaY * 0.001)))
      }
      canvas.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mouseup',   onMouseUp)
      window.addEventListener('mousemove', onMouseMove)
      canvas.addEventListener('wheel',     onWheel, { passive: false })

      // ── Depth texture ─────────────────────────────────────────────────
      let depthTexture  = null
      let simTime       = 0
      let lastFrameTime = 0

      const frame = (timestamp) => {
        if (destroyed) return
        animId = requestAnimationFrame(frame)

        const dt = lastFrameTime === 0
          ? 1 / 60
          : Math.min((timestamp - lastFrameTime) / 1000, 0.05)
        lastFrameTime = timestamp
        if (isRunningRef.current) simTime += dt

        // Sync inlet velocity from Leva params
        cyclone.setInletVelocity(paramsRef.current.inletVelocity ?? 15)

        // ── Resize ────────────────────────────────────────────────────
        const pxr = Math.min(window.devicePixelRatio || 1, 2)
        const w   = Math.max(1, Math.floor(canvas.clientWidth  * pxr))
        const h   = Math.max(1, Math.floor(canvas.clientHeight * pxr))
        if (!depthTexture || canvas.width !== w || canvas.height !== h) {
          canvas.width  = w
          canvas.height = h
          depthTexture?.destroy()
          depthTexture = device.createTexture({
            size: [w, h],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        }

        // ── Camera matrices ────────────────────────────────────────────
        const proj = mat4.perspective(FOV, w / h, 0.1, 100)
        const eye  = [
          CAMERA_TARGET[0] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
          CAMERA_TARGET[1] + camera.distance * Math.sin(camera.pitch),
          CAMERA_TARGET[2] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
        ]
        const view     = mat4.lookAt(eye, CAMERA_TARGET, [0, 1, 0])
        const identity = mat4.identity()

        // ── Particle uniforms ──────────────────────────────────────────
        particleUV.texelSize.set([1 / w, 1 / h])
        particleUV.sphereSizeBase[0] = 0.04
        particleUV.invProj.set(mat4.inverse(proj))
        particleUV.proj.set(proj)
        particleUV.view.set(view)
        particleUV.invView.set(mat4.inverse(view))
        device.queue.writeBuffer(particleUniformBuf, 0, particleUniformData)

        // ── Geometry uniforms ──────────────────────────────────────────
        writeGeomUniform(device, cylinderUniformBuf,     proj, view, identity, [0.60, 0.85, 1.00, 0.18], eye)
        writeGeomUniform(device, coneUniformBuf,         proj, view, identity, [0.55, 0.80, 0.95, 0.18], eye)
        writeGeomUniform(device, vortexFinderUniformBuf, proj, view, identity, [0.70, 0.72, 0.80, 0.85], eye)

        // ── Command encoder ────────────────────────────────────────────
        const encoder = device.createCommandEncoder()

        // Compute: particle physics step
        if (isRunningRef.current) {
          cyclone.step(encoder, simTime)
        }

        // Render pass
        const colorView = context.getCurrentTexture().createView()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view:       colorView,
            clearValue: { r: 0.86, g: 0.93, b: 1.0, a: 1 },
            loadOp:     'clear',
            storeOp:    'store',
          }],
          depthStencilAttachment: {
            view:            depthTexture.createView(),
            depthClearValue: 1,
            depthLoadOp:     'clear',
            depthStoreOp:    'store',
          },
        })

        // 1. Opaque: vortex finder
        pass.setPipeline(opaquePipeline)
        pass.setBindGroup(0, vortexFinderBG)
        pass.setVertexBuffer(0, meshes.vortexFinder.vertexBuffer)
        pass.setIndexBuffer(meshes.vortexFinder.indexBuffer, 'uint32')
        pass.drawIndexed(meshes.vortexFinder.indexCount)

        // 2. Particles (blend on)
        pass.setPipeline(particlePipeline)
        pass.setBindGroup(0, particleBindGroup)
        pass.draw(6, cyclone.numParticles)

        // 3. Transparent geometry (back-to-front: cone then cylinder)
        pass.setPipeline(transparentPipeline)

        pass.setBindGroup(0, coneBG)
        pass.setVertexBuffer(0, meshes.cone.vertexBuffer)
        pass.setIndexBuffer(meshes.cone.indexBuffer, 'uint32')
        pass.drawIndexed(meshes.cone.indexCount)

        pass.setBindGroup(0, cylinderBG)
        pass.setVertexBuffer(0, meshes.cylinder.vertexBuffer)
        pass.setIndexBuffer(meshes.cylinder.indexBuffer, 'uint32')
        pass.drawIndexed(meshes.cylinder.indexCount)

        pass.end()
        device.queue.submit([encoder.finish()])

        // ── Stats callback ─────────────────────────────────────────────
        if (onStatsUpdate) {
          onStatsUpdate({ simTime })
        }
      }

      animId = requestAnimationFrame(frame)

      // cleanup
      return () => {
        canvas.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mouseup',   onMouseUp)
        window.removeEventListener('mousemove', onMouseMove)
        canvas.removeEventListener('wheel',     onWheel)
        cyclone.destroy()
        depthTexture?.destroy()
      }
    })()

    return () => {
      destroyed = true
      if (animId) cancelAnimationFrame(animId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
      />
    </div>
  )
}
