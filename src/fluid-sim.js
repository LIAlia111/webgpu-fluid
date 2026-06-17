// fluid-sim.js
// 流体模拟核心：纹理管理、pipeline 构建、每帧调度
// 实现 Navier-Stokes 简化算法（半拉格朗日对流 + 压力求解 + 涡旋增强）

const CONFIG = {
  JACOBI_ITERATIONS:    20,
  VORTICITY_STRENGTH:   0.35,
  VELOCITY_DISSIPATION: 0.98,
  DYE_DISSIPATION:      0.97,
  SPLAT_RADIUS:         0.03,
  SPLAT_FORCE:          5.0,
  MAX_VELOCITY:         10.0,
  LOW_FPS_THRESHOLD:    25,
  LOW_FPS_JACOBI:       10,
};

// ─────────────────────────────────────────────
// DoubleBuffer：ping/pong 双纹理管理
// ─────────────────────────────────────────────
class DoubleBuffer {
  constructor(device, width, height, format) {
    const usage = GPUTextureUsage.TEXTURE_BINDING |
                  GPUTextureUsage.STORAGE_BINDING |
                  GPUTextureUsage.COPY_SRC;
    this.ping = device.createTexture({ size: [width, height], format, usage });
    this.pong = device.createTexture({ size: [width, height], format, usage });
    this.readIdx = 0;
  }
  get read()  { return this.readIdx === 0 ? this.ping : this.pong; }
  get write() { return this.readIdx === 0 ? this.pong : this.ping; }
  swap()      { this.readIdx ^= 1; }
  destroy()   { this.ping.destroy(); this.pong.destroy(); }
}

// ─────────────────────────────────────────────
// 辅助：计算模拟网格尺寸（对齐到 16 的倍数）
// ─────────────────────────────────────────────
function computeGridSize() {
  const maxDim = screen.width <= 768 ? 256 : 512;
  let w = Math.min(maxDim, Math.floor(window.innerWidth  / 4));
  let h = Math.min(maxDim, Math.floor(window.innerHeight / 4));
  w = Math.max(16, Math.round(w / 16) * 16);
  h = Math.max(16, Math.round(h / 16) * 16);
  return { w, h };
}

// ─────────────────────────────────────────────
// 辅助：创建单纹理（非双缓冲中间场）
// ─────────────────────────────────────────────
function createSingleTex(device, width, height, format) {
  return device.createTexture({
    size:   [width, height],
    format,
    usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
}

// ─────────────────────────────────────────────
// 辅助：fetch 加载 WGSL shader 并创建 ShaderModule
// ─────────────────────────────────────────────
async function loadShader(device, path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Shader load failed: ${path} (${res.status})`);
  const code = await res.text();
  return device.createShaderModule({ code });
}

// ─────────────────────────────────────────────
// FluidSim 主类
// ─────────────────────────────────────────────
export class FluidSim {
  #device;
  #context;
  #canvasFormat;
  #gridW = 0;
  #gridH = 0;

  // Textures
  #velocity;     // DoubleBuffer  rg32float
  #pressure;     // DoubleBuffer  r32float
  #divergence;   // Single tex    r32float
  #vortCurl;     // Single tex    r32float
  #dye;          // DoubleBuffer  rgba16float

  // Uniform Buffers
  #simParamsBuffer;
  #splatListBuffer;
  #renderParamsBuffer;

  // Sampler（linear clamp，render pass 采样 dye 场用）
  #sampler;

  // Pipelines
  #splatPipeline;
  #advectVelPipeline;
  #advectDyePipeline;
  #divergencePipeline;
  #pressurePipeline;
  #gradSubPipeline;
  #curlPipeline;
  #confinementPipeline;
  #renderPipeline;

  // 预建 Bind Groups（两套或四套，按 readIdx 索引）
  #bgSplat       = [null, null, null, null]; // indexed by vi*2+di (velocity.readIdx * 2 + dye.readIdx)
  #bgAdvectVel   = [null, null];   // indexed by velocity.readIdx
  #bgDivergence  = [null, null];   // indexed by velocity.readIdx
  #bgPressure    = [null, null];   // indexed by pressure.readIdx
  #bgGradSub     = null;           // Array[4]: velIdx*2+presIdx
  #bgCurl        = [null, null];   // indexed by velocity.readIdx
  #bgConfinement = [null, null];   // indexed by velocity.readIdx
  #bgAdvectDye   = null;           // Array[4]: velIdx*2+dyeIdx
  #bgRender      = [null, null];   // indexed by dye.readIdx

  // Pre-allocated uniform buffer staging arrays（避免每帧 new）
  #simParamsArray = new Float32Array(12);
  #splatListArray = new ArrayBuffer(336);
  #splatListView  = null; // 在 #createBuffers 中初始化

  // Low-FPS adaptation
  #consecutiveLowFps = 0;
  #jacobiIterations  = CONFIG.JACOBI_ITERATIONS;

  // ──────────────────────────────────────────────────────────────────────
  // init
  // ──────────────────────────────────────────────────────────────────────
  async init(device, context, canvasFormat, canvas) {
    this.#device       = device;
    this.#context      = context;
    this.#canvasFormat = canvasFormat;

    const { w, h } = computeGridSize();
    this.#gridW = w;
    this.#gridH = h;

    this.#createTextures(w, h);
    this.#createBuffers();

    this.#sampler = device.createSampler({
      magFilter:    'linear',
      minFilter:    'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    const BASE = '/webgpu-fluid/shaders/';
    const [
      advectMod,
      divergenceMod,
      pressureMod,
      gradSubMod,
      vorticityMod,
      splatMod,
      renderMod,
    ] = await Promise.all([
      loadShader(device, `${BASE}advect.wgsl`),
      loadShader(device, `${BASE}divergence.wgsl`),
      loadShader(device, `${BASE}pressure.wgsl`),
      loadShader(device, `${BASE}gradient_subtract.wgsl`),
      loadShader(device, `${BASE}vorticity.wgsl`),
      loadShader(device, `${BASE}splat.wgsl`),
      loadShader(device, `${BASE}render.wgsl`),
    ]);

    this.#createPipelines(
      advectMod, divergenceMod, pressureMod,
      gradSubMod, vorticityMod, splatMod, renderMod
    );

    this.#updateRenderParams(canvas.width, canvas.height);
    this.#prebuildBindGroups();
  }

  #createTextures(w, h) {
    const d = this.#device;
    this.#velocity   = new DoubleBuffer(d, w, h, 'rg32float');
    this.#pressure   = new DoubleBuffer(d, w, h, 'r32float');
    this.#divergence = createSingleTex(d, w, h, 'r32float');
    this.#vortCurl   = createSingleTex(d, w, h, 'r32float');
    this.#dye        = new DoubleBuffer(d, w, h, 'rgba16float');
  }

  #createBuffers() {
    const d = this.#device;
    this.#simParamsBuffer = d.createBuffer({
      size:  48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#splatListBuffer = d.createBuffer({
      size:  336,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#renderParamsBuffer = d.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // 初始化预分配的 DataView（复用 #splatListArray，不每帧 new）
    this.#splatListView = new DataView(this.#splatListArray);
  }

  #createPipelines(
    advectMod, divergenceMod, pressureMod,
    gradSubMod, vorticityMod, splatMod, renderMod
  ) {
    const d = this.#device;

    this.#splatPipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: splatMod, entryPoint: 'main' },
    });

    this.#advectVelPipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: advectMod, entryPoint: 'advect_velocity' },
    });

    this.#advectDyePipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: advectMod, entryPoint: 'advect_dye' },
    });

    this.#divergencePipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: divergenceMod, entryPoint: 'main' },
    });

    this.#pressurePipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: pressureMod, entryPoint: 'main' },
    });

    this.#gradSubPipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: gradSubMod, entryPoint: 'main' },
    });

    this.#curlPipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: vorticityMod, entryPoint: 'compute_curl' },
    });

    this.#confinementPipeline = d.createComputePipeline({
      layout:  'auto',
      compute: { module: vorticityMod, entryPoint: 'apply_confinement' },
    });

    this.#renderPipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module:     renderMod,
        entryPoint: 'vs_main',
      },
      fragment: {
        module:     renderMod,
        entryPoint: 'fs_main',
        targets:    [{ format: this.#canvasFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // 预创建所有 Bind Groups
  // ──────────────────────────────────────────────────────────────────────
  #prebuildBindGroups() {
    const d    = this.#device;
    const vel  = this.#velocity;
    const pres = this.#pressure;
    const dye  = this.#dye;
    const div  = this.#divergence;
    const curl = this.#vortCurl;
    const sp   = this.#simParamsBuffer;
    const sl   = this.#splatListBuffer;

    // splat.wgsl @group(0)
    // b0=SimParams b1=SplatList b2=velIn(r) b3=velOut(w) b4=dyeIn(r) b5=dyeOut(w)
    // 4 combinations: vi*2+di (velocity.readIdx * 2 + dye.readIdx)
    for (let vi = 0; vi < 2; vi++) {
      const velRead  = vi === 0 ? vel.ping : vel.pong;
      const velWrite = vi === 0 ? vel.pong : vel.ping;
      for (let di = 0; di < 2; di++) {
        const dyeRead  = di === 0 ? dye.ping : dye.pong;
        const dyeWrite = di === 0 ? dye.pong : dye.ping;
        this.#bgSplat[vi * 2 + di] = d.createBindGroup({
          layout: this.#splatPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sp } },
            { binding: 1, resource: { buffer: sl } },
            { binding: 2, resource: velRead.createView()  },
            { binding: 3, resource: velWrite.createView() },
            { binding: 4, resource: dyeRead.createView()  },
            { binding: 5, resource: dyeWrite.createView() },
          ],
        });
      }
    }

    // advect_velocity @group(0): b0=SimParams b1=velIn(r) b2=velOut(w)
    for (let i = 0; i < 2; i++) {
      const read  = i === 0 ? vel.ping : vel.pong;
      const write = i === 0 ? vel.pong : vel.ping;
      this.#bgAdvectVel[i] = d.createBindGroup({
        layout: this.#advectVelPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sp }    },
          { binding: 1, resource: read.createView()  },
          { binding: 2, resource: write.createView() },
        ],
      });
    }

    // divergence.wgsl @group(0): b0=SimParams b1=velocity(r) b2=outDiv(w)
    for (let i = 0; i < 2; i++) {
      const vRead = i === 0 ? vel.ping : vel.pong;
      this.#bgDivergence[i] = d.createBindGroup({
        layout: this.#divergencePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sp }    },
          { binding: 1, resource: vRead.createView() },
          { binding: 2, resource: div.createView()   },
        ],
      });
    }

    // pressure.wgsl @group(0): b0=SimParams b1=pressureIn(r) b2=divergence(r) b3=pressureOut(w)
    for (let i = 0; i < 2; i++) {
      const pRead  = i === 0 ? pres.ping : pres.pong;
      const pWrite = i === 0 ? pres.pong : pres.ping;
      this.#bgPressure[i] = d.createBindGroup({
        layout: this.#pressurePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sp }      },
          { binding: 1, resource: pRead.createView()  },
          { binding: 2, resource: div.createView()    },
          { binding: 3, resource: pWrite.createView() },
        ],
      });
    }

    // gradient_subtract.wgsl @group(0): b0=SimParams b1=pressure(r) b2=velIn(r) b3=velOut(w)
    // 4 combinations: velIdx*2+presIdx
    this.#bgGradSub = new Array(4);
    for (let vi = 0; vi < 2; vi++) {
      const vRead  = vi === 0 ? vel.ping : vel.pong;
      const vWrite = vi === 0 ? vel.pong : vel.ping;
      for (let pi = 0; pi < 2; pi++) {
        const pRead = pi === 0 ? pres.ping : pres.pong;
        this.#bgGradSub[vi * 2 + pi] = d.createBindGroup({
          layout: this.#gradSubPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sp }      },
            { binding: 1, resource: pRead.createView()  },
            { binding: 2, resource: vRead.createView()  },
            { binding: 3, resource: vWrite.createView() },
          ],
        });
      }
    }

    // compute_curl @group(0): b0=SimParams b1=velocity_curl(r) b2=outCurl(w)
    for (let i = 0; i < 2; i++) {
      const vRead = i === 0 ? vel.ping : vel.pong;
      this.#bgCurl[i] = d.createBindGroup({
        layout: this.#curlPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sp }     },
          { binding: 1, resource: vRead.createView() },
          { binding: 2, resource: curl.createView()  },
        ],
      });
    }

    // apply_confinement @group(0): b0=SimParams b1=curlTex(r) b2=velIn(r) b3=velOut(w)
    for (let i = 0; i < 2; i++) {
      const vRead  = i === 0 ? vel.ping : vel.pong;
      const vWrite = i === 0 ? vel.pong : vel.ping;
      this.#bgConfinement[i] = d.createBindGroup({
        layout: this.#confinementPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sp }      },
          { binding: 1, resource: curl.createView()   },
          { binding: 2, resource: vRead.createView()  },
          { binding: 3, resource: vWrite.createView() },
        ],
      });
    }

    // advect_dye @group(1): b0=SimParams b1=velIn(r) b2=dyeIn(r) b3=dyeOut(w)
    // 4 combinations: velIdx*2+dyeIdx
    this.#bgAdvectDye = new Array(4);
    for (let vi = 0; vi < 2; vi++) {
      const vRead = vi === 0 ? vel.ping : vel.pong;
      for (let di = 0; di < 2; di++) {
        const dRead  = di === 0 ? dye.ping : dye.pong;
        const dWrite = di === 0 ? dye.pong : dye.ping;
        this.#bgAdvectDye[vi * 2 + di] = d.createBindGroup({
          layout: this.#advectDyePipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: sp }      },
            { binding: 1, resource: vRead.createView()  },
            { binding: 2, resource: dRead.createView()  },
            { binding: 3, resource: dWrite.createView() },
          ],
        });
      }
    }

    // render.wgsl @group(0): b0=dyeTex(texture_2d) b1=samp b2=renderParams
    for (let i = 0; i < 2; i++) {
      const dRead = i === 0 ? dye.ping : dye.pong;
      this.#bgRender[i] = d.createBindGroup({
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: dRead.createView()                   },
          { binding: 1, resource: this.#sampler                        },
          { binding: 2, resource: { buffer: this.#renderParamsBuffer } },
        ],
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Uniform update helpers
  // ──────────────────────────────────────────────────────────────────────
  #updateSimParams(dt) {
    const data = this.#simParamsArray;
    data[0]  = dt;
    data[1]  = 1.0;
    data[2]  = 1.0 / this.#gridW;
    data[3]  = 1.0 / this.#gridH;
    data[4]  = this.#gridW;
    data[5]  = this.#gridH;
    data[6]  = CONFIG.SPLAT_RADIUS;
    data[7]  = CONFIG.VORTICITY_STRENGTH;
    data[8]  = CONFIG.VELOCITY_DISSIPATION;
    data[9]  = CONFIG.DYE_DISSIPATION;
    this.#device.queue.writeBuffer(this.#simParamsBuffer, 0, data);
  }

  #updateSplatBuffer(splats) {
    const view  = this.#splatListView;
    const count = Math.min(splats.length, 10);
    view.setUint32(0, count, true);
    for (let i = 0; i < count; i++) {
      const s   = splats[i];
      const off = 16 + i * 32;
      view.setFloat32(off +  0, s.u,        true);
      view.setFloat32(off +  4, s.v,        true);
      view.setFloat32(off +  8, s.dx,       true);
      view.setFloat32(off + 12, s.dy,       true);
      view.setFloat32(off + 16, s.color[0], true);
      view.setFloat32(off + 20, s.color[1], true);
      view.setFloat32(off + 24, s.color[2], true);
      view.setFloat32(off + 28, s.radius ?? CONFIG.SPLAT_RADIUS, true);
    }
    this.#device.queue.writeBuffer(this.#splatListBuffer, 0, this.#splatListArray);
  }

  #updateRenderParams(screenW, screenH) {
    const data = new Float32Array(4);
    data[0] = screenW;
    data[1] = screenH;
    this.#device.queue.writeBuffer(this.#renderParamsBuffer, 0, data);
  }

  // ──────────────────────────────────────────────────────────────────────
  // #dispatch — workgroup dispatch（调用前必须已 setPipeline + setBindGroup）
  // ──────────────────────────────────────────────────────────────────────
  #dispatch(pass) {
    const wX = Math.ceil(this.#gridW / 16);
    const wY = Math.ceil(this.#gridH / 16);
    pass.dispatchWorkgroups(wX, wY, 1);
  }

  // ──────────────────────────────────────────────────────────────────────
  // step — 一帧流体模拟
  // ──────────────────────────────────────────────────────────────────────
  step(dt, splats) {
    const d = this.#device;

    // 低帧率降级
    if (dt > 1.0 / CONFIG.LOW_FPS_THRESHOLD) {
      this.#consecutiveLowFps++;
      if (this.#consecutiveLowFps >= 3) {
        this.#jacobiIterations = CONFIG.LOW_FPS_JACOBI;
      }
    } else {
      this.#consecutiveLowFps = 0;
      this.#jacobiIterations  = CONFIG.JACOBI_ITERATIONS;
    }

    this.#updateSimParams(dt);
    this.#updateSplatBuffer(splats);

    const enc = d.createCommandEncoder();

    // Pass 0: Splat（仅有触控输入时）
    if (splats.length > 0) {
      const bgIdx = this.#velocity.readIdx * 2 + this.#dye.readIdx;
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#splatPipeline);
      pass.setBindGroup(0, this.#bgSplat[bgIdx]);
      this.#dispatch(pass);
      pass.end();
      // splat 已写入新纹理，swap 使后续 pass 读到最新数据
      this.#velocity.swap();
      this.#dye.swap();
    }

    // Pass 1: Advect Velocity
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#advectVelPipeline);
      pass.setBindGroup(0, this.#bgAdvectVel[this.#velocity.readIdx]);
      this.#dispatch(pass);
      pass.end();
    }
    this.#velocity.swap();

    // Pass 2: Divergence
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#divergencePipeline);
      pass.setBindGroup(0, this.#bgDivergence[this.#velocity.readIdx]);
      this.#dispatch(pass);
      pass.end();
    }

    // Pass 3: Pressure Jacobi (N iterations, swap inside loop)
    for (let i = 0; i < this.#jacobiIterations; i++) {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#pressurePipeline);
      pass.setBindGroup(0, this.#bgPressure[this.#pressure.readIdx]);
      this.#dispatch(pass);
      pass.end();
      this.#pressure.swap();
    }

    // Pass 4: Gradient Subtract
    {
      const bgIdx = this.#velocity.readIdx * 2 + this.#pressure.readIdx;
      const pass  = enc.beginComputePass();
      pass.setPipeline(this.#gradSubPipeline);
      pass.setBindGroup(0, this.#bgGradSub[bgIdx]);
      this.#dispatch(pass);
      pass.end();
    }
    this.#velocity.swap();

    // Pass 5a: Curl
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#curlPipeline);
      pass.setBindGroup(0, this.#bgCurl[this.#velocity.readIdx]);
      this.#dispatch(pass);
      pass.end();
    }

    // Pass 5b: Vorticity Confinement
    {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.#confinementPipeline);
      pass.setBindGroup(0, this.#bgConfinement[this.#velocity.readIdx]);
      this.#dispatch(pass);
      pass.end();
    }
    this.#velocity.swap();

    // Pass 6: Advect Dye (advect_dye uses @group(1), setBindGroup index = 1)
    {
      const bgIdx = this.#velocity.readIdx * 2 + this.#dye.readIdx;
      const pass  = enc.beginComputePass();
      pass.setPipeline(this.#advectDyePipeline);
      pass.setBindGroup(1, this.#bgAdvectDye[bgIdx]);
      this.#dispatch(pass);
      pass.end();
    }
    this.#dye.swap();

    // Pass 7: Render (render pass, full-screen quad, 6 vertices)
    {
      const colorView = this.#context.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view:       colorView,
          loadOp:     'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp:    'store',
        }],
      });
      pass.setPipeline(this.#renderPipeline);
      pass.setBindGroup(0, this.#bgRender[this.#dye.readIdx]);
      pass.draw(6, 1, 0, 0);
      pass.end();
    }

    const isDev = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
       (window.location.port !== '' && window.location.port !== '80' && window.location.port !== '443'));

    if (isDev) d.pushErrorScope('validation');
    d.queue.submit([enc.finish()]);
    if (isDev) {
      d.popErrorScope().then(err => {
        if (err) console.error('[WebGPU] GPU validation error:', err.message);
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // handleResize
  // ──────────────────────────────────────────────────────────────────────
  handleResize(canvas) {
    const { w, h } = computeGridSize();

    if (w !== this.#gridW || h !== this.#gridH) {
      this.#velocity.destroy();
      this.#pressure.destroy();
      this.#dye.destroy();
      this.#divergence.destroy();
      this.#vortCurl.destroy();

      this.#gridW = w;
      this.#gridH = h;

      this.#createTextures(w, h);
      this.#prebuildBindGroups();
    }

    this.#updateRenderParams(canvas.width, canvas.height);
  }

  // ──────────────────────────────────────────────────────────────────────
  // destroy
  // ──────────────────────────────────────────────────────────────────────
  destroy() {
    this.#velocity.destroy();
    this.#pressure.destroy();
    this.#dye.destroy();
    this.#divergence.destroy();
    this.#vortCurl.destroy();
    this.#simParamsBuffer.destroy();
    this.#splatListBuffer.destroy();
    this.#renderParamsBuffer.destroy();
  }
}
