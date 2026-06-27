import depthMapShader     from './depthMap.wgsl?raw'
import bilateralShader    from './bilateral.wgsl?raw'
import fluidShader        from './fluid.wgsl?raw'
import fullScreenShader   from './fullScreen.wgsl?raw'
import thicknessMapShader from './thicknessMap.wgsl?raw'
import gaussianShader     from './gaussian.wgsl?raw'
import foamShader         from './foam.wgsl?raw'

export class ReactorFluidRenderer {
  constructor(device, canvas, presentationFormat, radius, fov, posvelBuffer, renderUniformBuffer) {
    this.device = device
    this._posvelBuffer = posvelBuffer
    this._renderUniformBuffer = renderUniformBuffer
    this._radius = radius
    this._fov = fov
    this._presentationFormat = presentationFormat

    // Agitation speed — updated each frame via setAgitationSpeed()
    this._agitationSpeed = 0

    // Compile shader modules (reused across resizes)
    this._vertexModule       = device.createShaderModule({ code: fullScreenShader })
    this._depthMapModule     = device.createShaderModule({ code: depthMapShader })
    this._bilateralModule    = device.createShaderModule({ code: bilateralShader })
    this._fluidModule        = device.createShaderModule({ code: fluidShader })
    this._thicknessMapModule = device.createShaderModule({ code: thicknessMapShader })
    this._gaussianModule     = device.createShaderModule({ code: gaussianShader })
    this._foamModule         = device.createShaderModule({ code: foamShader })

    // Foam uniform buffer: 2×mat4x4f (128 bytes) + 4×f32 (16 bytes) = 144 bytes
    this._foamUniformBuffer = device.createBuffer({
      label: 'foam uniforms',
      size:  144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Filter direction uniform buffers (constant, never need resize)
    const filterXData = new Float32Array([1.0, 0.0])
    const filterYData = new Float32Array([0.0, 1.0])
    this._filterXUniformBuffer = device.createBuffer({
      label: 'filterX uniform',
      size: filterXData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this._filterYUniformBuffer = device.createBuffer({
      label: 'filterY uniform',
      size: filterYData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this._filterXUniformBuffer, 0, filterXData)
    device.queue.writeBuffer(this._filterYUniformBuffer, 0, filterYData)

    this._sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

    // Build screen-size-independent pipelines now
    this._buildPipelines(canvas)

    // Build screen-size-dependent textures + bind groups
    this._buildTextures(canvas)
    this._buildBindGroups()
  }

  /** Call every frame before execute() so the foam threshold tracks agitation. */
  setAgitationSpeed(speed) {
    this._agitationSpeed = speed ?? 0
  }

  _buildPipelines(canvas) {
    const device = this.device
    const radius = this._radius
    const fov    = this._fov

    const screenConstants = {
      screenHeight: canvas.height,
      screenWidth:  canvas.width,
    }
    const filterConstants = {
      depth_threshold:             radius * 10,
      max_filter_size:             100,
      projected_particle_constant: (12 * (2 * radius) * 0.05 * (canvas.height / 2)) / Math.tan(fov / 2),
    }

    // ── Error scope: capture any silent pipeline-creation failures ────────
    device.pushErrorScope('validation')

    // ── Depth map (r32float, sphere impostors) ────────────────────────────
    this._depthMapPipeline = device.createRenderPipeline({
      label: 'fluid depthMap pipeline',
      layout: 'auto',
      vertex:   { module: this._depthMapModule },
      fragment: { module: this._depthMapModule, targets: [{ format: 'r32float' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
    })

    // ── Bilateral depth filter — 'auto' is safe here because the depth ────
    //    texture is r32float whose sampleType matches 'unfilterable-float', ─
    //    which is exactly what textureLoad infers in the auto-layout.        ─
    this._depthFilterPipeline = device.createRenderPipeline({
      label: 'fluid bilateral filter pipeline',
      layout: 'auto',
      vertex:   { module: this._vertexModule, constants: screenConstants },
      fragment: { module: this._bilateralModule, constants: filterConstants, targets: [{ format: 'r32float' }] },
      primitive: { topology: 'triangle-list' },
    })

    // ── Thickness map (r16float, additive blending) ───────────────────────
    //    r16float is required here: r32float has no blend support in WebGPU.
    this._thicknessMapPipeline = device.createRenderPipeline({
      label: 'fluid thicknessMap pipeline',
      layout: 'auto',
      vertex:   { module: this._thicknessMapModule },
      fragment: {
        module: this._thicknessMapModule,
        targets: [{
          format: 'r16float',
          writeMask: GPUColorWrite.RED,
          blend: {
            color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
            alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    // ── Gaussian thickness filter — explicit BGL required ─────────────────
    //    gaussian.wgsl uses textureLoad → auto-layout would infer           ─
    //    sampleType:'unfilterable-float'. But the thickness texture is       ─
    //    r16float whose sampleType is 'float'. Explicit layout fixes the     ─
    //    mismatch without changing the texture format (which would break     ─
    //    additive blending).                                                 ─
    this._thicknessFilterBGL = device.createBindGroupLayout({
      label: 'thicknessFilter BGL',
      entries: [
        {
          binding:    1,
          visibility: GPUShaderStage.FRAGMENT,
          texture:    { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
        {
          binding:    2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer:     { type: 'uniform' },
        },
      ],
    })
    this._thicknessFilterPipeline = device.createRenderPipeline({
      label: 'fluid gaussian filter pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._thicknessFilterBGL] }),
      vertex:   { module: this._vertexModule, constants: screenConstants },
      fragment: { module: this._gaussianModule, targets: [{ format: 'r16float' }] },
      primitive: { topology: 'triangle-list' },
    })

    // ── Fluid composite — explicit BGL required ───────────────────────────
    //    fluid.wgsl (binding 1) reads the r32float depth texture → keep     ─
    //    sampleType:'unfilterable-float'.                                    ─
    //    fluid.wgsl (binding 3) reads the r16float thickness texture →      ─
    //    must be sampleType:'float'. The unused sampler at binding 0 has    ─
    //    been removed from the shader so it no longer appears here.         ─
    this._fluidBGL = device.createBindGroupLayout({
      label: 'fluid composite BGL',
      entries: [
        {
          binding:    1,
          visibility: GPUShaderStage.FRAGMENT,
          texture:    { sampleType: 'unfilterable-float', viewDimension: '2d', multisampled: false },
        },
        {
          binding:    2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer:     { type: 'uniform' },
        },
        {
          binding:    3,
          visibility: GPUShaderStage.FRAGMENT,
          texture:    { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
      ],
    })
    this._fluidPipeline = device.createRenderPipeline({
      label: 'fluid composite pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._fluidBGL] }),
      vertex:   { module: this._vertexModule, constants: screenConstants },
      fragment: { module: this._fluidModule, targets: [{ format: this._presentationFormat }] },
      primitive: { topology: 'triangle-list' },
    })

    // ── Foam sprite pass — additive-ish alpha blend over the fluid surface ─
    this._foamPipeline = device.createRenderPipeline({
      label: 'foam pipeline',
      layout: 'auto',
      vertex:   { module: this._foamModule },
      fragment: {
        module: this._foamModule,
        targets: [{
          format: this._presentationFormat,
          blend: {
            color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { operation: 'add', srcFactor: 'one',       dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive:    { topology: 'triangle-list' },
      depthStencil: {
        // depthCompare:'always' + depthWriteEnabled:false → no depth rejection,
        // foam always draws over the fluid but is still blended correctly.
        depthWriteEnabled: false,
        depthCompare:      'always',
        format:            'depth32float',
      },
    })

    // ── Pop error scope — any pipeline creation failure will be logged ─────
    device.popErrorScope().then(err => {
      if (err) console.error('[ReactorFluidRenderer] _buildPipelines validation error:', err.message)
    })

    // Remember screen constants so resize() can detect change
    this._screenConstants = screenConstants
  }

  _buildTextures(canvas) {
    const device = this.device
    const size   = [canvas.width, canvas.height, 1]
    const rwUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

    // Destroy old textures if any
    this._depthMapTexture?.destroy()
    this._tmpDepthMapTexture?.destroy()
    this._thicknessTexture?.destroy()
    this._tmpThicknessTexture?.destroy()
    this._depthTestTexture?.destroy()

    this._depthMapTexture     = device.createTexture({ label: 'depthMap',     size, format: 'r32float',     usage: rwUsage })
    this._tmpDepthMapTexture  = device.createTexture({ label: 'tmpDepthMap',  size, format: 'r32float',     usage: rwUsage })
    this._thicknessTexture    = device.createTexture({ label: 'thickness',    size, format: 'r16float',     usage: rwUsage })
    this._tmpThicknessTexture = device.createTexture({ label: 'tmpThickness', size, format: 'r16float',     usage: rwUsage })
    this._depthTestTexture    = device.createTexture({ label: 'depthTest',    size, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT })

    this._depthMapTextureView     = this._depthMapTexture.createView()
    this._tmpDepthMapTextureView  = this._tmpDepthMapTexture.createView()
    this._thicknessTextureView    = this._thicknessTexture.createView()
    this._tmpThicknessTextureView = this._tmpThicknessTexture.createView()
    this._depthTestTextureView    = this._depthTestTexture.createView()
  }

  _buildBindGroups() {
    const device = this.device

    this._depthMapBindGroup = device.createBindGroup({
      label: 'depthMap bindGroup',
      layout: this._depthMapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._posvelBuffer } },
        { binding: 1, resource: { buffer: this._renderUniformBuffer } },
      ],
    })

    // _depthFilterPipeline uses layout:'auto' and r32float depth textures.
    // textureLoad on texture_2d<f32> → auto-layout sampleType:'unfilterable-float'
    // r32float sampleType is 'unfilterable-float' → match ✓
    this._depthFilterBindGroups = [
      device.createBindGroup({
        label: 'depthFilter X bindGroup',
        layout: this._depthFilterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: this._depthMapTextureView },
          { binding: 2, resource: { buffer: this._filterXUniformBuffer } },
        ],
      }),
      device.createBindGroup({
        label: 'depthFilter Y bindGroup',
        layout: this._depthFilterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: this._tmpDepthMapTextureView },
          { binding: 2, resource: { buffer: this._filterYUniformBuffer } },
        ],
      }),
    ]

    this._thicknessMapBindGroup = device.createBindGroup({
      label: 'thicknessMap bindGroup',
      layout: this._thicknessMapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._posvelBuffer } },
        { binding: 1, resource: { buffer: this._renderUniformBuffer } },
      ],
    })

    // Use the explicit _thicknessFilterBGL (sampleType:'float') so that the
    // r16float texture views are accepted.  Auto-layout would infer
    // 'unfilterable-float' (from textureLoad) which does not match r16float.
    this._thicknessFilterBindGroups = [
      device.createBindGroup({
        label: 'thicknessFilter X bindGroup',
        layout: this._thicknessFilterBGL,
        entries: [
          { binding: 1, resource: this._thicknessTextureView },
          { binding: 2, resource: { buffer: this._filterXUniformBuffer } },
        ],
      }),
      device.createBindGroup({
        label: 'thicknessFilter Y bindGroup',
        layout: this._thicknessFilterBGL,
        entries: [
          { binding: 1, resource: this._tmpThicknessTextureView },
          { binding: 2, resource: { buffer: this._filterYUniformBuffer } },
        ],
      }),
    ]

    // Use the explicit _fluidBGL:
    //   binding 1 → sampleType:'unfilterable-float' (r32float depth) ✓
    //   binding 2 → uniform buffer ✓
    //   binding 3 → sampleType:'float' (r16float thickness) ✓
    // The unused sampler that was at binding 0 has been removed from both the
    // shader and this bind group to prevent the auto-layout gap error.
    this._fluidBindGroup = device.createBindGroup({
      label: 'fluid composite bindGroup',
      layout: this._fluidBGL,
      entries: [
        { binding: 1, resource: this._depthMapTextureView },
        { binding: 2, resource: { buffer: this._renderUniformBuffer } },
        { binding: 3, resource: this._thicknessTextureView },
      ],
    })

    // ── Foam bind group — posvelBuffer + foam uniforms ────────────────────
    this._foamBindGroup = device.createBindGroup({
      label: 'foam bindGroup',
      layout: this._foamPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._posvelBuffer } },
        { binding: 1, resource: { buffer: this._foamUniformBuffer } },
      ],
    })
  }

  resize(canvas) {
    // Rebuild pipelines only if screen size changed (overrideable constants)
    const sameSize =
      this._screenConstants.screenWidth  === canvas.width &&
      this._screenConstants.screenHeight === canvas.height
    if (!sameSize) {
      this._buildPipelines(canvas)
    }
    this._buildTextures(canvas)
    this._buildBindGroups()
  }

  execute(commandEncoder, context, numParticles, projection, view) {
    // ── 1. Depth map pass ─────────────────────────────────────────────────
    {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._depthMapTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this._depthTestTextureView,
          depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      })
      pass.setPipeline(this._depthMapPipeline)
      pass.setBindGroup(0, this._depthMapBindGroup)
      pass.draw(6, numParticles)
      pass.end()
    }

    // ── 2–9. Bilateral filter — 4 X+Y passes ─────────────────────────────
    for (let i = 0; i < 4; i++) {
      // X pass → writes into tmpDepthMap
      {
        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: this._tmpDepthMapTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store',
          }],
        })
        pass.setPipeline(this._depthFilterPipeline)
        pass.setBindGroup(0, this._depthFilterBindGroups[0])
        pass.draw(6)
        pass.end()
      }
      // Y pass → writes back into depthMap
      {
        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: this._depthMapTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store',
          }],
        })
        pass.setPipeline(this._depthFilterPipeline)
        pass.setBindGroup(0, this._depthFilterBindGroups[1])
        pass.draw(6)
        pass.end()
      }
    }

    // ── 10. Thickness map pass ────────────────────────────────────────────
    {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._thicknessTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      })
      pass.setPipeline(this._thicknessMapPipeline)
      pass.setBindGroup(0, this._thicknessMapBindGroup)
      pass.draw(6, numParticles)
      pass.end()
    }

    // ── 11–12. Gaussian filter — 1 X+Y pass ──────────────────────────────
    {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._tmpThicknessTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      })
      pass.setPipeline(this._thicknessFilterPipeline)
      pass.setBindGroup(0, this._thicknessFilterBindGroups[0])
      pass.draw(6)
      pass.end()
    }
    {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this._thicknessTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      })
      pass.setPipeline(this._thicknessFilterPipeline)
      pass.setBindGroup(0, this._thicknessFilterBindGroups[1])
      pass.draw(6)
      pass.end()
    }

    // ── 13. Fluid composite — renders to swapchain ────────────────────────
    {
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.86, g: 0.93, b: 1, a: 1 },
          loadOp: 'clear', storeOp: 'store',
        }],
      })
      pass.setPipeline(this._fluidPipeline)
      pass.setBindGroup(0, this._fluidBindGroup)
      pass.draw(6)
      pass.end()
    }

    // ── 14. Foam sprite pass — soft white billboards over the fluid ───────
    // Only writes pixels when speed > foam_threshold (computed from agitation).
    // Uses alpha-blending so low-alpha foam doesn't whiteout the fluid colour.
    {
      // Derive threshold/max from current agitation: at rest threshold is very
      // high (nothing visible); at full speed threshold drops to ~0.1 so most
      // fast-moving particles produce foam.
      const foamSpeed     = this._agitationSpeed
      const foamThreshold = Math.max(0.05, 0.8 - foamSpeed * 0.7)   // 0.8 → 0.1
      const foamMaxSpeed  = foamThreshold + 0.5
      const foamSize      = 0.06   // world-space billboard half-size (~60 % of particle diameter)

      // Layout: [proj 16 f32][view 16 f32][size, threshold, max, pad]  = 36 f32 = 144 bytes
      const foamData = new Float32Array(36)
      foamData.set(projection, 0)
      foamData.set(view,       16)
      foamData[32] = foamSize
      foamData[33] = foamThreshold
      foamData[34] = foamMaxSpeed
      foamData[35] = 0
      this.device.queue.writeBuffer(this._foamUniformBuffer, 0, foamData)

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view:    context.getCurrentTexture().createView(),
          loadOp:  'load',    // draw OVER the fluid composite
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view:            this._depthTestTextureView,
          depthClearValue: 1,
          depthLoadOp:     'load',   // reuse depth from pass 1
          depthStoreOp:    'store',
        },
      })
      pass.setPipeline(this._foamPipeline)
      pass.setBindGroup(0, this._foamBindGroup)
      pass.draw(6, numParticles)
      pass.end()
    }
  }

  destroy() {
    this._depthMapTexture?.destroy()
    this._tmpDepthMapTexture?.destroy()
    this._thicknessTexture?.destroy()
    this._tmpThicknessTexture?.destroy()
    this._depthTestTexture?.destroy()
    this._filterXUniformBuffer?.destroy()
    this._filterYUniformBuffer?.destroy()
    this._foamUniformBuffer?.destroy()
  }
}
