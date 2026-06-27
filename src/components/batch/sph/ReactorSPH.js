import densityShader from './density.wgsl?raw'
import forceShader from './force.wgsl?raw'
import integrateShader from './integrate.wgsl?raw'
import copyPositionShader from './copyPosition.wgsl?raw'
import gridBuildShader from './grid/gridBuild.wgsl?raw'
import gridClearShader from './grid/gridClear.wgsl?raw'
import reorderShader from './grid/reorderParticles.wgsl?raw'
import { PrefixSumKernel } from 'webgpu-radix-sort'

export const REACTOR_R = 0.87
export const REACTOR_BOT = -1.32
export const REACTOR_TOP = 0.6
export const LIQUID_FILL_Y = -0.10
export const SHAFT_R = 0.04
export const IMPELLER_Y = -0.95
export const IMPELLER_R = 0.36
export const IMPELLER_H = 0.052
export const PARTICLE_RENDER_SIZE = 0.056

const PARTICLE_STRIDE = 64
const POSVEL_STRIDE = 32

export class ReactorSPH {
  constructor(device, numParticles = 15000) {
    this.device = device
    this.numParticles = numParticles

    this.kernelRadius = 0.07
    const h = this.kernelRadius
    this.sphParams = {
      mass: 1.0,
      kernelRadius: h,
      kernelRadiusPow2: h * h,
      kernelRadiusPow5: h ** 5,
      kernelRadiusPow6: h ** 6,
      kernelRadiusPow9: h ** 9,
      dt: 0.006,
      stiffness: 20.0,
      nearStiffness: 1.0,
      restDensity: 15000.0,
      viscosity: 100.0,
      n: numParticles,
    }

    const cellSize = h
    const xHalf = 1.5
    const yHalf = 1.5
    const zHalf = 1.5
    const sentinel = 4 * cellSize
    const xLen = 2 * xHalf + sentinel
    const yLen = 2 * yHalf + sentinel
    const zLen = 2 * zHalf + sentinel
    this.xGrids = Math.ceil(xLen / cellSize)
    this.yGrids = Math.ceil(yLen / cellSize)
    this.zGrids = Math.ceil(zLen / cellSize)
    this.gridCount = this.xGrids * this.yGrids * this.zGrids
    this.offset = sentinel / 2
    this.cellSize = cellSize
    this.xHalf = xHalf
    this.yHalf = yHalf
    this.zHalf = zHalf
  }

  async init(agitSpeed = 0) {
    const { device, numParticles: n } = this

    this.particleBuffer = device.createBuffer({
      size: n * PARTICLE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.particleBuffer, 0, this._initParticles())

    this.posvelBuffer = device.createBuffer({
      size: n * POSVEL_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    })

    this.sortedParticleBuffer = device.createBuffer({
      size: n * PARTICLE_STRIDE,
      usage: GPUBufferUsage.STORAGE,
    })

    this.cellParticleCountBuffer = device.createBuffer({
      size: 4 * (this.gridCount + 1),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.particleCellOffsetBuffer = device.createBuffer({
      size: 4 * n,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.realBoxSizeBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(
      this.realBoxSizeBuffer,
      0,
      new Float32Array([this.xHalf, this.yHalf, this.zHalf, 0]),
    )

    const environmentValues = new ArrayBuffer(32)
    const environmentI32 = new Int32Array(environmentValues)
    const environmentF32 = new Float32Array(environmentValues)
    environmentI32[0] = this.xGrids
    environmentI32[1] = this.yGrids
    environmentI32[2] = this.zGrids
    environmentF32[3] = this.cellSize
    environmentF32[4] = this.xHalf
    environmentF32[5] = this.yHalf
    environmentF32[6] = this.zHalf
    environmentF32[7] = this.offset
    this.environmentBuffer = device.createBuffer({
      size: environmentValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.environmentBuffer, 0, environmentValues)

    const sphValues = new ArrayBuffer(48)
    const sphF32 = new Float32Array(sphValues)
    const sphU32 = new Uint32Array(sphValues)
    const p = this.sphParams
    sphF32[0] = p.mass
    sphF32[1] = p.kernelRadius
    sphF32[2] = p.kernelRadiusPow2
    sphF32[3] = p.kernelRadiusPow5
    sphF32[4] = p.kernelRadiusPow6
    sphF32[5] = p.kernelRadiusPow9
    sphF32[6] = p.dt
    sphF32[7] = p.stiffness
    sphF32[8] = p.nearStiffness
    sphF32[9] = p.restDensity
    sphF32[10] = p.viscosity
    sphU32[11] = n
    this.sphParamsBuffer = device.createBuffer({
      size: sphValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.sphParamsBuffer, 0, sphValues)

    this.impellerParamsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.updateImpeller(agitSpeed, false)

    this.prefixSumKernel = new PrefixSumKernel({
      device,
      data: this.cellParticleCountBuffer,
      count: this.gridCount + 1,
    })

    this._createPipelines()
    this._createBindGroups()
  }

  _initParticles() {
    const buffer = new ArrayBuffer(this.numParticles * PARTICLE_STRIDE)
    const view = new DataView(buffer)
    let index = 0
    let attempts = 0
    const maxAttempts = this.numParticles * 24
    const yMin = REACTOR_BOT + 0.05
    const yMax = LIQUID_FILL_Y - 0.08

    while (index < this.numParticles && attempts < maxAttempts) {
      attempts += 1
      const px = (Math.random() * 2 - 1) * REACTOR_R * 0.9
      const pz = (Math.random() * 2 - 1) * REACTOR_R * 0.9
      const r = Math.hypot(px, pz)
      if (r > REACTOR_R * 0.88 || r < SHAFT_R + 0.05) continue

      const py = yMin + Math.random() * (yMax - yMin)
      const base = index * PARTICLE_STRIDE
      view.setFloat32(base + 0, px, true)
      view.setFloat32(base + 4, py, true)
      view.setFloat32(base + 8, pz, true)
      index += 1
    }

    while (index < this.numParticles) {
      const angle = Math.random() * Math.PI * 2
      const radius = SHAFT_R + 0.05 + Math.random() * (REACTOR_R * 0.86 - SHAFT_R - 0.05)
      const py = yMin + Math.random() * (yMax - yMin)
      const base = index * PARTICLE_STRIDE
      view.setFloat32(base + 0, Math.cos(angle) * radius, true)
      view.setFloat32(base + 4, py, true)
      view.setFloat32(base + 8, Math.sin(angle) * radius, true)
      index += 1
    }

    return buffer
  }

  _createPipelines() {
    const { device } = this
    this.gridClearPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: gridClearShader }),
        entryPoint: 'main',
      },
    })
    this.gridBuildPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: gridBuildShader }),
        entryPoint: 'main',
      },
    })
    this.reorderPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: reorderShader }),
        entryPoint: 'main',
      },
    })
    this.densityPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: densityShader }),
        entryPoint: 'computeDensity',
      },
    })
    this.forcePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: forceShader }),
        entryPoint: 'computeForce',
      },
    })
    this.integratePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: integrateShader }),
        entryPoint: 'integrate',
      },
    })
    this.copyPositionPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: copyPositionShader }),
        entryPoint: 'copyPosition',
      },
    })
  }

  _createBindGroups() {
    const { device } = this

    this.gridClearBindGroup = device.createBindGroup({
      layout: this.gridClearPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cellParticleCountBuffer } }],
    })

    this.gridBuildBindGroup = device.createBindGroup({
      layout: this.gridBuildPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cellParticleCountBuffer } },
        { binding: 1, resource: { buffer: this.particleCellOffsetBuffer } },
        { binding: 2, resource: { buffer: this.particleBuffer } },
        { binding: 3, resource: { buffer: this.environmentBuffer } },
        { binding: 4, resource: { buffer: this.sphParamsBuffer } },
      ],
    })

    this.reorderBindGroup = device.createBindGroup({
      layout: this.reorderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.sortedParticleBuffer } },
        { binding: 2, resource: { buffer: this.cellParticleCountBuffer } },
        { binding: 3, resource: { buffer: this.particleCellOffsetBuffer } },
        { binding: 4, resource: { buffer: this.environmentBuffer } },
        { binding: 5, resource: { buffer: this.sphParamsBuffer } },
      ],
    })

    this.densityBindGroup = device.createBindGroup({
      layout: this.densityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.sortedParticleBuffer } },
        { binding: 2, resource: { buffer: this.cellParticleCountBuffer } },
        { binding: 3, resource: { buffer: this.environmentBuffer } },
        { binding: 4, resource: { buffer: this.sphParamsBuffer } },
      ],
    })

    this.forceBindGroup = device.createBindGroup({
      layout: this.forcePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.sortedParticleBuffer } },
        { binding: 2, resource: { buffer: this.cellParticleCountBuffer } },
        { binding: 3, resource: { buffer: this.environmentBuffer } },
        { binding: 4, resource: { buffer: this.sphParamsBuffer } },
      ],
    })

    this.integrateBindGroup = device.createBindGroup({
      layout: this.integratePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.sphParamsBuffer } },
        { binding: 2, resource: { buffer: this.impellerParamsBuffer } },
      ],
    })

    this.copyPositionBindGroup = device.createBindGroup({
      layout: this.copyPositionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.posvelBuffer } },
        { binding: 2, resource: { buffer: this.sphParamsBuffer } },
      ],
    })
  }

  updateImpeller(agitSpeed = 0, running = false) {
    if (!this.impellerParamsBuffer) return
    const data = new Float32Array(8)
    data[0] = IMPELLER_Y
    data[1] = IMPELLER_R
    data[2] = IMPELLER_H
    data[3] = SHAFT_R
    data[4] = REACTOR_R
    data[5] = REACTOR_BOT
    data[6] = LIQUID_FILL_Y
    data[7] = running ? agitSpeed : 0
    this.device.queue.writeBuffer(this.impellerParamsBuffer, 0, data)
  }

  step(commandEncoder) {
    const particleWg = Math.ceil(this.numParticles / 64)
    const gridWg = Math.ceil((this.gridCount + 1) / 64)
    const pass = commandEncoder.beginComputePass()

    pass.setPipeline(this.gridClearPipeline)
    pass.setBindGroup(0, this.gridClearBindGroup)
    pass.dispatchWorkgroups(gridWg)

    pass.setPipeline(this.gridBuildPipeline)
    pass.setBindGroup(0, this.gridBuildBindGroup)
    pass.dispatchWorkgroups(particleWg)

    this.prefixSumKernel.dispatch(pass)

    pass.setPipeline(this.reorderPipeline)
    pass.setBindGroup(0, this.reorderBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.setPipeline(this.densityPipeline)
    pass.setBindGroup(0, this.densityBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.setPipeline(this.reorderPipeline)
    pass.setBindGroup(0, this.reorderBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.setPipeline(this.forcePipeline)
    pass.setBindGroup(0, this.forceBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.setPipeline(this.integratePipeline)
    pass.setBindGroup(0, this.integrateBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.setPipeline(this.copyPositionPipeline)
    pass.setBindGroup(0, this.copyPositionBindGroup)
    pass.dispatchWorkgroups(particleWg)

    pass.end()
  }

  destroy() {
    this.particleBuffer?.destroy()
    this.posvelBuffer?.destroy()
    this.sortedParticleBuffer?.destroy()
    this.cellParticleCountBuffer?.destroy()
    this.particleCellOffsetBuffer?.destroy()
    this.realBoxSizeBuffer?.destroy()
    this.environmentBuffer?.destroy()
    this.sphParamsBuffer?.destroy()
    this.impellerParamsBuffer?.destroy()
  }
}
