# Design Doc: WebGPU 流体涟漪 Demo

**版本**：v1.0  
**日期**：2026-05-21  
**对应 PRD**：PRD v1.0  
**对应 UI Spec**：UI_SPEC v1.0  
**状态**：待实现

---

## 0. 关键技术决策摘要

| 决策项 | 选择 | 理由 |
|--------|------|------|
| WebGPU 不可用降级 | 仅显示提示页，不做 WebGL2 回退 | 保持代码简洁，明确的技术定位 |
| Canvas 格式 | `navigator.gpu.getPreferredCanvasFormat()` 动态获取 | 跨平台最佳兼容性，取代固定 `bgra8unorm` [覆盖 PRD F1：getPreferredCanvasFormat() 取代硬编码 bgra8unorm，理由：iOS Safari 首选格式为 rgba8unorm，硬编码会导致初始化失败] |
| 时间步长 | 可变步长，基于实际帧时间，clamp 到 `[1/120, 1/30]` | 防大步长数值爆炸，兼顾帧率波动 [覆盖 PRD F2：可变步长 clamp 取代固定 1/60s，理由：低帧率场景固定步长会导致数值模拟发散] |
| 网格分辨率 | `min(512, Math.floor(viewport/4))` 移动端不超过 512 | 移动端 GPU 内存与性能平衡 |
| Jacobi 迭代次数 | 20 次/帧 | 性能 vs 压力求解质量平衡点 |
| 染料场格式 | `rgba16float` | 颜色精度充足，移动端兼容性好 |
| 速度场格式 | 分量拆分为两个 `r32float` 纹理 | 计算 pass 中 read/write 不混用组件更清晰 |

---

## 1. 架构概览

### 1.1 文件结构

```
/root/lief-projects/webgpu-fluid/
├── index.html                  # 入口 HTML，内联关键 CSS，DOM 骨架
├── style.css                   # 全局样式，不兼容提示页样式，加载动画
├── vite.config.js              # Vite 配置（MIME type、构建参数）
├── nginx-site.conf             # Nginx 部署配置片段
├── src/
│   ├── main.js                 # 入口：协调初始化、DOM 状态切换、启动渲染
│   ├── webgpu-init.js          # WebGPU 初始化：adapter/device/canvas context
│   ├── fluid-sim.js            # 流体模拟核心：纹理管理、pipeline 构建、每帧调度
│   ├── touch-handler.js        # 输入处理：touch/mouse 事件，坐标转换，splat 参数
│   └── renderer.js             # 渲染主循环：rAF、dt 计算、帧率统计
└── shaders/
    ├── advect.wgsl              # 半拉格朗日对流（速度场 self-advect + dye advect）
    ├── divergence.wgsl          # 速度场散度计算
    ├── pressure.wgsl            # Jacobi 压力迭代单步
    ├── gradient_subtract.wgsl   # 压力梯度减法（enforce divergence-free）
    ├── vorticity.wgsl           # 涡旋计算 + confinement force 注入
    ├── splat.wgsl               # 高斯点速度注入（触控/鼠标）
    └── render.wgsl              # 全屏 quad 渲染（dye 场 → 屏幕颜色）
```

### 1.2 模块依赖关系

```
main.js
  ├── webgpu-init.js          获取 GPUDevice + canvas context
  ├── fluid-sim.js            依赖 GPUDevice，持有所有 GPU 资源
  │     └── shaders/*.wgsl    编译为 GPUShaderModule（在 fluid-sim 内部加载）
  ├── touch-handler.js        依赖 canvas element，输出 SplatList
  └── renderer.js             依赖 fluid-sim + touch-handler，驱动每帧执行
        └── fluid-sim.step(dt, splats)  每帧调用
```

**数据流（单向）**：

```
用户触控/鼠标
    ↓  touch-handler.js
SplatList（UV 坐标 + 速度向量，每帧最多 10 条）
    ↓  renderer.js 每帧传入
fluid-sim.step(dt, splats)
    ├── [1] splat compute pass：将 SplatList 注入速度场纹理
    ├── [2] advect compute pass：速度场自我对流
    ├── [3] divergence compute pass：计算散度场
    ├── [4] pressure solve loop：Jacobi 迭代 20 次
    ├── [5] gradient subtract compute pass：速度场去散度化
    ├── [6] vorticity compute pass：涡旋增强
    └── [7] dye advect compute pass：染料场对流
    ↓
render pass：dye 纹理 → canvas swap chain
    ↓
屏幕显示
```

---

## 2. WebGPU 初始化模块（webgpu-init.js）

### 2.1 初始化流程

```
navigator.gpu 存在？
    否 → throw new Error('WebGPU_NOT_SUPPORTED')
    是 ↓
navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    返回 null → throw new Error('WebGPU_ADAPTER_NULL')
    超时 5000ms → throw new Error('WebGPU_TIMEOUT')
    成功 ↓ adapter
adapter.requestDevice({
  requiredLimits: {
    maxTextureDimension2D: 4096,   // 512×512 纹理充裕
    maxStorageTexturesPerShaderStage: 4  // compute pass 最多需要 4 个 storage texture
  }
})
    失败 → throw new Error('WebGPU_DEVICE_FAILED')
    成功 ↓ device
device.lost.then(() => → 触发重新初始化或显示错误页)
canvas.getContext('webgpu')
    返回 null → throw new Error('WebGPU_CONTEXT_NULL')
    成功 ↓ context
context.configure({
  device,
  format: navigator.gpu.getPreferredCanvasFormat(),
  alphaMode: 'opaque'
})
返回 { device, context, canvasFormat }
```

### 2.2 超时实现

```javascript
const INIT_TIMEOUT_MS = 5000;
const adapterPromise = navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('WebGPU_TIMEOUT')), INIT_TIMEOUT_MS)
);
const adapter = await Promise.race([adapterPromise, timeoutPromise]);
```

### 2.3 canvas 配置参数

| 参数 | 值 | 说明 |
|------|----|------|
| `format` | `navigator.gpu.getPreferredCanvasFormat()` | iOS Safari 返回 `bgra8unorm`，桌面 Chrome 返回 `bgra8unorm` 或 `rgba8unorm` |
| `alphaMode` | `'opaque'` | 无透明度合成，性能最优 |
| `usage` | `GPUTextureUsage.RENDER_ATTACHMENT` | 默认值，render pass 写入 |

### 2.4 降级路径

任何步骤抛出异常，均由 `main.js` catch：

```javascript
// main.js
try {
  const gpu = await initWebGPU(canvas);
  startSimulation(gpu);
} catch (e) {
  if (import.meta.env.DEV) console.error(e);
  else console.warn('WebGPU not supported');
  showUnsupportedPage();
}
```

不向用户暴露任何错误信息，统一进入不兼容提示页。

### 2.5 device lost 处理

```javascript
device.lost.then((info) => {
  console.warn('WebGPU device lost:', info.reason, info.message);
  // 销毁当前模拟，尝试重新初始化一次
  // 若再次失败，进入 showUnsupportedPage()
  restartOrFallback();
});
```

---

## 3. 流体模拟模块（fluid-sim.js）

### 3.1 Navier-Stokes 简化算法说明

求解不可压缩流体的简化 Navier-Stokes 方程：

```
∂u/∂t = -(u·∇)u - ∇p + ν∇²u + f
∇·u = 0  （不可压缩约束）
```

本实现忽略粘性扩散项（`ν∇²u`），用数值耗散（半拉格朗日对流的隐式耗散）代替，不单独做扩散 pass。

**每帧执行顺序（共 7 个 compute pass + 1 个 render pass）**：

| 步骤 | Pass | 描述 |
|------|------|------|
| 1 | Splat | 将触控/鼠标速度注入速度场（高斯点）|
| 2 | Advect Velocity | 速度场自我对流（半拉格朗日）|
| 3 | Divergence | 计算速度场散度 ∇·u |
| 4 | Pressure Solve | Jacobi 迭代 20 次求解 ∇²p = ∇·u |
| 5 | Gradient Subtract | u = u - ∇p（使 u 满足 ∇·u = 0）|
| 6 | Vorticity | 计算涡量 ω = ∇×u，叠加 confinement force |
| 7 | Advect Dye | 染料场沿速度场对流 |
| 8 | Render | Dye 场 → 屏幕颜色 |

### 3.2 纹理资源规格

所有纹理分辨率 = `gridWidth × gridHeight`（见§8 自适应分辨率）。

| 纹理名 | 格式 | 用途 | 双缓冲 |
|--------|------|------|--------|
| `velocity_x` | `r32float` | 速度场 X 分量 | 是（ping/pong）|
| `velocity_y` | `r32float` | 速度场 Y 分量 | 是（ping/pong）|
| `pressure` | `r32float` | 压力场 | 是（ping/pong）|
| `divergence` | `r32float` | 散度场（单帧中间值）| 否 |
| `vorticity` | `r32float` | 涡量场（单帧中间值）| 否 |
| `dye` | `rgba16float` | 染料/颜色场 | 是（ping/pong）|

**纹理用途标志**：

```javascript
const TEX_USAGE = GPUTextureUsage.TEXTURE_BINDING    // 作为 sampler 输入
               | GPUTextureUsage.STORAGE_BINDING     // 作为 storage texture 输出
               | GPUTextureUsage.COPY_SRC;           // 调试时可 readback
```

**注意**：`r32float` 格式在 WebGPU 中 storage binding 需要 `float32-filterable` feature 或使用 `textureLoad` 而非 sampler 采样。Advect pass 使用双线性插值时改用 `rgba32float`（打包 xy 分量）或通过 `textureLoad` 手动插值。

实际采用方案：**速度场打包为 `rg32float`（x,y 合一）**，简化 bind group 布局：

| 纹理名（最终）| 格式 | 双缓冲 |
|--------------|------|--------|
| `velocity` | `rg32float` | 是 |
| `pressure` | `r32float` | 是 |
| `divergence` | `r32float` | 否 |
| `vorticity_curl` | `r32float` | 否 |
| `dye` | `rgba16float` | 是 |

### 3.3 双缓冲 Ping-Pong 结构

```javascript
class DoubleBuffer {
  constructor(device, width, height, format) {
    this.ping = device.createTexture({ size: [width, height], format, usage: TEX_USAGE });
    this.pong = device.createTexture({ size: [width, height], format, usage: TEX_USAGE });
    this.readIdx = 0;  // 0 = ping 为 read，1 = pong 为 read
  }
  get read()  { return this.readIdx === 0 ? this.ping : this.pong; }
  get write() { return this.readIdx === 0 ? this.pong : this.ping; }
  swap()      { this.readIdx ^= 1; }
}
```

每个 compute pass 结束后调用 `buffer.swap()`。

### 3.4 Uniforms 布局

所有 compute shader 共用一个 Uniform Buffer，按 16 字节对齐：

```wgsl
struct SimParams {
  dt:           f32,   // offset 0,  size 4
  rdx:          f32,   // offset 4,  size 4  (1 / dx，网格间距倒数)
  texelSize:    vec2f, // offset 8,  size 8  (1/width, 1/height)
  // --- 16 byte boundary ---
  gridSize:     vec2f, // offset 16, size 8  (width, height)
  splatRadius:  f32,   // offset 24, size 4  (高斯点半径，归一化网格单位)
  vorticityStr: f32,   // offset 28, size 4  (涡旋增强系数)
  // --- 32 byte boundary ---
  dissipation:  f32,   // offset 32, size 4  (速度耗散，每帧乘以此值)
  dyeDissip:    f32,   // offset 36, size 4  (染料耗散)
  _pad0:        f32,   // offset 40, padding
  _pad1:        f32,   // offset 44, padding
  // total: 48 bytes
}
```

### 3.5 每帧 Bind Group 布局

每个 compute pass 使用独立 `GPUBindGroupLayout`。下表描述各 pass 的绑定：

#### Pass 0: Splat（`@group(0)`）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<rg32float, read_write>` | velocity.write |
| 2 | `texture_storage_2d<rgba16float, read_write>` | dye.write |

splat 参数通过额外的 Splat Uniform Buffer 传入（每帧最多 10 个 splat）：

```wgsl
struct Splat {
  uv:       vec2f,  // 触点归一化坐标 [0,1]
  velocity: vec2f,  // 速度向量（已乘力度系数）
  color:    vec3f,  // 染料颜色（可按速度大小变化）
  radius:   f32,    // 高斯半径（通常 = SimParams.splatRadius）
}
struct SplatList {
  count:  u32,
  _pad:   array<u32, 3>,
  splats: array<Splat, 10>,  // 最多 10 个
}
```

| binding | 类型 | 内容 |
|---------|------|------|
| 3 | `uniform` | `SplatList` |

#### Pass 1: Advect Velocity（`@group(0)`）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture<f32>` | velocity.read（sampler 采样用于双线性插值）|
| 2 | `sampler` | linear clamp sampler |
| 3 | `texture_storage_2d<rg32float, write>` | velocity.write |

> **注意**：`rg32float` 不支持 `filterable` sampler（除非启用 `float32-filterable` feature）。如设备不支持该 feature，改用 `textureLoad` + 手动双线性插值（4 次 load + lerp）。

#### Pass 2: Divergence（`@group(0)`）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<rg32float, read>` | velocity.read |
| 2 | `texture_storage_2d<r32float, write>` | divergence（单缓冲）|

#### Pass 3: Pressure Jacobi（`@group(0)`，每次迭代不同 ping-pong）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<r32float, read>` | pressure.read |
| 2 | `texture_storage_2d<r32float, read>` | divergence（只读）|
| 3 | `texture_storage_2d<r32float, write>` | pressure.write |

Jacobi 迭代 20 次时，在 CPU 侧循环调度 20 次 dispatch，每次交换 pressure ping-pong：

```javascript
for (let i = 0; i < JACOBI_ITERATIONS; i++) {
  encodeJacobiPass(encoder, pressureBuf.read, divergenceTex, pressureBuf.write, simParamsBuffer);
  pressureBuf.swap();
}
```

#### Pass 4: Gradient Subtract（`@group(0)`）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<r32float, read>` | pressure.read |
| 2 | `texture_storage_2d<rg32float, read>` | velocity.read |
| 3 | `texture_storage_2d<rg32float, write>` | velocity.write |

#### Pass 5: Vorticity（`@group(0)`）

两步实现：先计算 curl，再注入 confinement force。

**Step 5a: Curl 计算**

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<rg32float, read>` | velocity.read |
| 2 | `texture_storage_2d<r32float, write>` | vorticity_curl |

**Step 5b: Confinement Force 注入**

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture_storage_2d<r32float, read>` | vorticity_curl |
| 2 | `texture_storage_2d<rg32float, read>` | velocity.read |
| 3 | `texture_storage_2d<rg32float, write>` | velocity.write |

#### Pass 6: Advect Dye（`@group(0)`）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `uniform` | `SimParams` |
| 1 | `texture<f32>` | velocity.read（采样用）|
| 2 | `texture<f32>` | dye.read（采样用）|
| 3 | `sampler` | linear clamp sampler |
| 4 | `texture_storage_2d<rgba16float, write>` | dye.write |

#### Pass 7: Render（`@group(0)`，render pass）

| binding | 类型 | 内容 |
|---------|------|------|
| 0 | `texture<f32>` | dye.read |
| 1 | `sampler` | linear clamp sampler |
| 2 | `uniform buffer` | `RenderParams { screenSize: vec2<f32> }` — Fragment shader 用于坐标计算 |

### 3.6 Compute Shader Workgroup 尺寸

所有 compute shader 统一使用：

```wgsl
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  if (coord.x >= i32(params.gridSize.x) || coord.y >= i32(params.gridSize.y)) { return; }
  // ...
}
```

Dispatch 调用：

```javascript
const wgX = Math.ceil(gridWidth  / 16);
const wgY = Math.ceil(gridHeight / 16);
pass.dispatchWorkgroups(wgX, wgY, 1);
```

对于 512×512 网格：dispatch = 32×32 = 1024 workgroups，每组 256 线程，共 262144 线程。

---

## 4. Shader 模块（shaders/）

每个 WGSL 文件只描述接口，不包含完整实现。

### 4.1 advect.wgsl

**职责**：半拉格朗日对流，将标量场/速度场沿速度场回溯一步。

**输入 Uniforms**：`SimParams`（使用 `dt`、`texelSize`、`gridSize`）

**Bind Group（advect velocity 版本）**：
```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var velocityTex: texture_2d<f32>;   // 速度场（read，用于回溯）
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var outVelocity: texture_storage_2d<rg32float, write>;
```

**Bind Group（advect dye 版本，同文件不同 entry point 或独立 shader）**：
```wgsl
@group(0) @binding(1) var velocityTex: texture_2d<f32>;
@group(0) @binding(2) var dyeTex: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var outDye: texture_storage_2d<rgba16float, write>;
```

**核心逻辑**（半拉格朗日）：
```
texcoord = (coord + 0.5) * texelSize          // 当前像素 UV
velocity = sample(velocityTex, texcoord)       // 读取当前速度
prevCoord = texcoord - velocity * dt * rdx     // 回溯到上一帧位置
result = sample(inputField, prevCoord)         // 双线性采样
result *= dissipation                          // 耗散
write(outField, coord, result)
```

**边界处理**：clamp_to_edge，边缘像素读到边缘值（等效 no-slip 对 velocity），dye 则自然衰减。

### 4.2 divergence.wgsl

**职责**：计算速度场散度 `div = ∂u/∂x + ∂v/∂y`，供压力求解使用。

**Bind Group**：
```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var outDiv: texture_storage_2d<r32float, write>;
```

**核心公式**（中心差分，使用 4 邻域）：
```
L = load(velocity, coord + (-1, 0)).x
R = load(velocity, coord + ( 1, 0)).x
D = load(velocity, coord + (0, -1)).y
U = load(velocity, coord + (0,  1)).y
div = (R - L + U - D) * 0.5 * rdx
```

**边界处理**：越界坐标 clamp 到网格范围内（等效 Neumann 边界）。

### 4.3 pressure.wgsl

**职责**：Jacobi 迭代单步，求解压力泊松方程 `∇²p = div`。

**Jacobi 公式**：`p_new[i,j] = (p[i-1,j] + p[i+1,j] + p[i,j-1] + p[i,j+1] - div[i,j]) / 4`

**Bind Group**：
```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var pressureIn: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var divergence: texture_storage_2d<r32float, read>;
@group(0) @binding(3) var pressureOut: texture_storage_2d<r32float, write>;
```

**注意**：每次 dispatch 执行一次迭代，由 CPU 侧循环 20 次调度，每次交换 ping-pong buffer。首帧压力场初始化为全零。

### 4.4 gradient_subtract.wgsl

**职责**：从速度场中减去压力梯度，使速度场满足不可压缩约束。

**公式**：
```
grad_p_x = (p[i+1,j] - p[i-1,j]) * 0.5 * rdx
grad_p_y = (p[i,j+1] - p[i,j-1]) * 0.5 * rdx
u_new = u - grad_p_x
v_new = v - grad_p_y
```

**Bind Group**：
```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var pressure: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var velocityIn: texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var velocityOut: texture_storage_2d<rg32float, write>;
```

**边界处理**：边界像素强制设为 (0,0)（no-slip 边界条件）。

### 4.5 vorticity.wgsl

**职责（Step a：curl 计算）**：

涡量标量 `ω = ∂v/∂x - ∂u/∂y`（2D 涡量 z 分量）。

```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var outCurl: texture_storage_2d<r32float, write>;
```

**公式**：
```
dv_dx = (v[i+1,j] - v[i-1,j]) * 0.5 * rdx
du_dy = (u[i,j+1] - u[i,j-1]) * 0.5 * rdx
curl = dv_dx - du_dy
```

**职责（Step b：confinement force）**：

计算涡旋增强力并叠加到速度场。

```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var curlTex: texture_storage_2d<r32float, read>;
@group(0) @binding(2) var velocityIn: texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var velocityOut: texture_storage_2d<rg32float, write>;
```

**公式**（Confinement Force，Fedkiw 2001 简化版）：
```
curl_L = abs(curl[i-1,j]);  curl_R = abs(curl[i+1,j])
curl_D = abs(curl[i,j-1]);  curl_U = abs(curl[i,j+1])
// 涡量梯度（指向涡量增大方向）
N = normalize(vec2(curl_U - curl_D, curl_R - curl_L) + 1e-5)
// confinement force = ε × (N × curl)（2D 叉积）
force = vorticityStr * vec2(N.y * curl[i,j], -N.x * curl[i,j])
velocity_new = velocity + force * dt
```

`vorticityStr` 默认值 0.35，对应 `SimParams.vorticityStr`。

### 4.6 splat.wgsl

**职责**：将触控/鼠标输入以高斯点形式注入速度场和染料场。

```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<uniform> splats: SplatList;
@group(0) @binding(2) var velocityInOut: texture_storage_2d<rg32float, read_write>;
@group(0) @binding(3) var dyeInOut: texture_storage_2d<rgba16float, read_write>;
```

**核心逻辑（对每个 splat）**：
```
for each splat in splats[0..count]:
  splatPos = splat.uv * gridSize                  // UV → 网格坐标
  d = distance(coord, splatPos)
  gauss = exp(-d * d / (splat.radius * gridSize.x)^2)
  if gauss > 0.001:
    vel += splat.velocity * gauss
    dye += splat.color * gauss
velocity_new = clamp(velocity_old + vel, -MAX_VELOCITY, MAX_VELOCITY)
dye_new = min(dye_old + dye, 1.0)
```

`MAX_VELOCITY = 10.0`（归一化网格单位/帧）。

### 4.7 render.wgsl

**职责**：全屏 quad，将 dye 场采样后映射为屏幕颜色。

**顶点着色器**（简单全屏三角形，无顶点 buffer）：

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // 两个三角形覆盖 NDC [-1,1]
  let x = f32((vi & 1u) * 2u) - 1.0;
  let y = f32((vi & 2u)) - 1.0;
  return vec4f(x, y, 0.0, 1.0);
}
// drawCount = 6（两个三角形），无顶点 buffer
```

**片元着色器 Bind Group**：
```wgsl
@group(0) @binding(0) var dyeTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
```

**颜色映射（依据 UI_SPEC §2.2）**：
```wgsl
@fragment
fn fs_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = fragCoord.xy / screenSize;
  let dye = textureSample(dyeTex, samp, uv).rgb;
  // dye.rg 存储速度可视化颜色（由 dye advect 传播），b 为辅助通道
  // 映射到 HSL 色彩空间，突出低速区域，保留方向色偏
  // 见 UI_SPEC §2.2 Fragment Shader 颜色公式
  let mag = length(dye.rg);
  let brightness = pow(min(mag * 3.0, 1.0), 0.6);
  let baseHue = 195.0;
  let dir = atan2(dye.g, dye.r);
  let hue = baseHue + dir * 15.0 / 3.14159;
  let color = hsl_to_rgb(hue, 0.85, brightness * 0.55 + 0.02);
  let gradient = length(vec2(dpdx(mag), dpdy(mag)));
  let highlight = smoothstep(0.3, 1.0, gradient) * brightness;
  return vec4f(color + vec3f(highlight * 0.8), 1.0);
}
```

**Fragment Shader 额外 Uniform**：
```wgsl
struct RenderParams {
  screenSize: vec2f,  // canvas 物理像素宽高
  _pad:       vec2f,
}
@group(0) @binding(2) var<uniform> renderParams: RenderParams;
```

---

## 5. 触控输入模块（touch-handler.js）

### 5.1 数据结构

```javascript
// 每个活跃触点的状态
class TouchPoint {
  id;           // touch.identifier（鼠标用 -1）
  prevX;        // 上一帧 CSS 像素坐标
  prevY;
  currX;        // 当前 CSS 像素坐标
  currY;
  active;       // 是否还在屏幕上
}

// 每帧输出格式，传入 fluid-sim.step()
class Splat {
  u;      // 归一化坐标 [0,1]
  v;      // 归一化坐标 [0,1]
  dx;     // 速度 x（网格单位/帧，已乘力度系数）
  dy;     // 速度 y
  color;  // [r, g, b] 染料颜色（由速度大小决定）
}
```

### 5.2 事件监听注册

```javascript
// 非 passive，允许 preventDefault
const opts = { passive: false };
canvas.addEventListener('touchstart',   onTouchStart,  opts);
canvas.addEventListener('touchmove',    onTouchMove,   opts);
canvas.addEventListener('touchend',     onTouchEnd,    opts);
canvas.addEventListener('touchcancel',  onTouchEnd,    opts);

canvas.addEventListener('mousedown',   onMouseDown);
canvas.addEventListener('mousemove',   onMouseMove);
canvas.addEventListener('mouseup',     onMouseUp);
canvas.addEventListener('mouseleave',  onMouseUp);   // 防止鼠标移出 canvas 后状态残留

canvas.addEventListener('contextmenu', e => e.preventDefault());
```

### 5.3 坐标转换

```javascript
function toUV(cssX, cssY) {
  const rect = canvas.getBoundingClientRect();
  return {
    u: (cssX - rect.left) / rect.width,    // [0, 1]
    v: (cssY - rect.top)  / rect.height,   // [0, 1]（Y 轴向下）
  };
}
// 注意：不用 devicePixelRatio，坐标在归一化后 DPR 差异消除
```

### 5.4 速度向量计算

```javascript
function computeVelocity(prev, curr, dt) {
  const scaleFactor = SPLAT_FORCE * (1.0 / dt);  // SPLAT_FORCE = 5.0
  return {
    dx: (curr.u - prev.u) * scaleFactor,
    dy: (curr.v - prev.v) * scaleFactor,
  };
}
// 速度阈值：|dx| + |dy| < 1e-4 时不生成 splat（静止触点不注入）
```

### 5.5 颜色分配

每个触点分配一个预设颜色，按 touch.identifier % colors.length 索引：

```javascript
const SPLAT_COLORS = [
  [0.0, 0.78, 0.91],   // 青蓝 #00c4e8
  [0.0, 0.91, 0.63],   // 绿青 #00e8a0
  [0.7, 0.9,  1.0 ],   // 浅蓝
  [0.4, 0.6,  1.0 ],   // 蓝紫
  [0.0, 0.6,  0.85],   // 深青
];
```

### 5.6 每帧输出

`TouchHandler.getSplats()` 在 renderer 每帧调用，返回当前帧的 `Splat[]`（最多 10 个），并清空帧内缓存。

### 5.7 鼠标兼容

```javascript
let mouseDown = false;
let mousePrev = null;

function onMouseDown(e) {
  mouseDown = true;
  mousePrev = toUV(e.clientX, e.clientY);
}
function onMouseMove(e) {
  if (!mouseDown) return;
  const curr = toUV(e.clientX, e.clientY);
  // 生成与 touch 相同格式的 splat
  addSplat(mousePrev, curr);
  mousePrev = curr;
}
function onMouseUp() {
  mouseDown = false;
  mousePrev = null;
}
```

---

## 6. Renderer 模块（renderer.js）

### 6.1 主循环结构

```javascript
class Renderer {
  #lastTime = null;
  #frameCount = 0;
  #fpsAccum = 0;
  #rafId = null;

  start() {
    this.#rafId = requestAnimationFrame(this.#loop.bind(this));
  }

  stop() {
    cancelAnimationFrame(this.#rafId);
  }

  #loop(now) {
    this.#rafId = requestAnimationFrame(this.#loop.bind(this));

    // dt 计算
    if (this.#lastTime === null) { this.#lastTime = now; return; }
    const rawDt = (now - this.#lastTime) / 1000.0;  // 秒
    this.#lastTime = now;

    const dt = Math.max(1/120, Math.min(rawDt, 1/30));  // clamp [8.3ms, 33.3ms]

    // 获取当前帧的触控输入
    const splats = this.touchHandler.getSplats();

    // 执行模拟步骤
    this.fluidSim.step(dt, splats);

    // FPS 统计（仅开发模式）
    if (import.meta.env.DEV) this.#updateFps(rawDt);
  }
}
```

### 6.2 时间步长策略

| 情况 | rawDt | clamp 后 dt | 说明 |
|------|-------|------------|------|
| 正常 60fps | 16.7ms → 0.0167s | 0.0167s | 正常 |
| 低帧率 30fps | 33.3ms → 0.0333s | 0.0333s | 上限，防止大步长不稳定 |
| 后台恢复 | 1000ms → 1.0s | 0.0333s | clamp 防止一次性大跳步 |
| 高帧率 120fps | 8.3ms → 0.0083s | 0.0083s | 下限，防止步长过小数值问题 |

### 6.3 CommandEncoder 结构（fluid-sim.step 内部）

```javascript
step(dt, splats) {
  this.#updateUniforms(dt);        // 写入 SimParams uniform buffer
  this.#updateSplatBuffer(splats); // 写入 SplatList uniform buffer

  const encoder = this.device.createCommandEncoder();

  // 7 个 compute pass
  this.#encodeSplatPass(encoder);
  this.#encodeAdvectVelocityPass(encoder);
  this.#encodeDivergencePass(encoder);
  for (let i = 0; i < JACOBI_ITERATIONS; i++) {  // 20 次
    this.#encodeJacobiPass(encoder);
    this.pressure.swap();
  }
  this.#encodeGradientSubtractPass(encoder);
  this.#encodeVorticityPass(encoder);            // curl + confinement（2 sub-passes）
  this.#encodeAdvectDyePass(encoder);

  // 1 个 render pass
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: this.context.getCurrentTexture().createView(),
      loadOp: 'clear',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      storeOp: 'store',
    }]
  });
  this.#encodeRenderPass(renderPass);
  renderPass.end();

  this.device.queue.submit([encoder.finish()]);

  // ping-pong 交换（pressure 已在 Jacobi 循环内完成 20 次 swap，不再额外 swap）
  this.velocity.swap();
  this.dye.swap();
}
```

### 6.4 FPS 计数器（开发模式）

```javascript
#updateFps(rawDt) {
  this.#fpsAccum += rawDt;
  this.#frameCount++;
  if (this.#fpsAccum >= 0.5) {   // 每 500ms 更新一次
    const fps = Math.round(this.#frameCount / this.#fpsAccum);
    this.fpsEl.textContent = `${fps} fps`;
    this.fpsEl.style.color = fps < 30
      ? 'rgba(255,80,80,0.9)'
      : 'rgba(0,196,232,0.8)';
    this.#fpsAccum = 0;
    this.#frameCount = 0;
  }
}
```

---

## 7. 纹理资源管理

### 7.1 创建时机

全部纹理在 `FluidSim.init(device, gridWidth, gridHeight)` 中一次性创建：

```javascript
init(device, gridWidth, gridHeight) {
  this.gridW = gridWidth;
  this.gridH = gridHeight;
  this.velocity  = new DoubleBuffer(device, gridW, gridH, 'rg32float');
  this.pressure  = new DoubleBuffer(device, gridW, gridH, 'r32float');
  this.divergence = createTexture(device, gridW, gridH, 'r32float');
  this.vortCurl   = createTexture(device, gridW, gridH, 'r32float');
  this.dye       = new DoubleBuffer(device, gridW, gridH, 'rgba16float');
  // 初始化为零（device.queue.writeTexture 写入零值）
  this.#clearAllTextures();
}
```

### 7.2 销毁时机

`FluidSim.destroy()` 显式销毁所有 GPU 资源：

```javascript
destroy() {
  [this.velocity.ping, this.velocity.pong,
   this.pressure.ping, this.pressure.pong,
   this.divergence, this.vortCurl,
   this.dye.ping, this.dye.pong].forEach(t => t.destroy());
  // 同时销毁 pipelines、bind groups、uniform buffers
  this.simParamsBuffer.destroy();
  this.splatListBuffer.destroy();
}
```

### 7.3 Resize 处理

监听 `window.resize` 事件，防抖 200ms：

```javascript
window.addEventListener('resize', debounce(() => {
  const { w, h } = computeGridSize();  // 见§8
  canvas.width  = Math.round(window.innerWidth  * Math.min(devicePixelRatio, 2));
  canvas.height = Math.round(window.innerHeight * Math.min(devicePixelRatio, 2));
  // 若网格分辨率变化则重建纹理
  if (w !== fluidSim.gridW || h !== fluidSim.gridH) {
    fluidSim.destroy();
    fluidSim.init(device, w, h);
    // 同时重建 render pipeline（因 canvas format 不变，只需重建 bind group）
  }
  // 更新 RenderParams uniform（screenSize）
  fluidSim.updateRenderParams(canvas.width, canvas.height);
}, 200));
```

---

## 8. 性能考量

### 8.1 模拟分辨率自适应

```javascript
function computeGridSize() {
  // 使用 screen.width 检测设备类型，使用 window.innerWidth / window.innerHeight 计算实际分辨率
  // 与 UI_SPEC §8 分辨率断点一致
  const maxDim = screen.width <= 768 ? 256 : 512;  // 低端移动设备（≤768px）上限 256，高端移动和桌面上限 512
  const vpDiv4W = Math.floor(window.innerWidth  / 4);
  const vpDiv4H = Math.floor(window.innerHeight / 4);
  const w = Math.min(maxDim, vpDiv4W, 512);
  const h = Math.min(maxDim, vpDiv4H, 512);
  // 对齐到 16 的倍数（workgroup_size=16 要求）
  return {
    w: Math.max(16, Math.round(w / 16) * 16),
    h: Math.max(16, Math.round(h / 16) * 16),
  };
}
```

典型值：

| 设备 | viewport | gridSize | 纹理内存（5张 rg32float）|
|------|----------|----------|------------------------|
| iPhone 12（375×812）| 375×812 | 93×203 → 96×208 | ~3.8 MB |
| iPhone 15 Pro（393×852）| 393×852 | 98×213 → 96×224 | ~4.2 MB |
| 桌面 1920×1080 | 1920×1080 | 480×270 → 480×272 | ~20 MB |
| 上限限制后 | 任意 | 512×512 | ~26 MB |

> 实际内存含双缓冲，约 ×2，最高约 52 MB，低于 PRD 200 MB 限制。

### 8.2 Jacobi 迭代次数影响

| 迭代次数 | 压力质量 | 单帧 GPU 时间（估算 512×512）| 说明 |
|----------|----------|---------------------------|------|
| 10 次 | 较低（速度场有明显散度）| ~4ms | 低端设备备用 |
| 20 次 | 良好（本项目默认）| ~7ms | 目标 < 8ms |
| 40 次 | 高质量 | ~14ms | 不推荐移动端 |

低端设备检测（基于 `device.limits.maxComputeWorkgroupsPerDimension < 65535`，不可靠）可改为运行时帧率检测：若连续 3 帧 dt > 25ms，自动将 JACOBI_ITERATIONS 降至 10。

### 8.3 GPU 内存峰值估算

| 纹理 | 格式 | 512×512 字节 | 双缓冲 |
|------|------|-------------|--------|
| velocity | rg32float | 512×512×8 = 2MB | ×2 = 4MB |
| pressure | r32float | 512×512×4 = 1MB | ×2 = 2MB |
| dye | rgba16float | 512×512×8 = 2MB | ×2 = 4MB |
| divergence | r32float | 1MB | ×1 = 1MB |
| vorticity | r32float | 1MB | ×1 = 1MB |
| **总计** | | | **12MB** |

加上 shader、pipeline、uniform buffers 约 1MB，总 GPU 内存约 13MB，远低于 200MB 限制。

### 8.4 移动端专项优化

- DPR 最大取 2（超过 2 的设备也只用 2），防止 Canvas 分辨率过高
- 避免使用 `float32-filterable` feature，改用手动双线性插值（更广泛兼容）
- Splat pass 每帧最多 10 个，防止 uniform buffer 过大
- 不使用 timestamp query（移动端通常不支持）

---

## 9. 完整文件结构

```
/root/lief-projects/webgpu-fluid/
├── index.html                  # 入口，内联关键 CSS，见 UI_SPEC §7
├── style.css                   # 全局样式 + 不兼容页样式 + 加载动画
├── vite.config.js              # Vite 配置
├── nginx-site.conf             # Nginx 部署配置片段
├── src/
│   ├── main.js                 # 入口模块
│   ├── config.js               # 模拟参数常量（集中配置）
│   ├── webgpu-init.js          # WebGPU 初始化
│   ├── fluid-sim.js            # 流体模拟核心
│   ├── touch-handler.js        # 触控/鼠标输入
│   └── renderer.js             # 渲染主循环
└── shaders/
    ├── advect.wgsl
    ├── divergence.wgsl
    ├── pressure.wgsl
    ├── gradient_subtract.wgsl
    ├── vorticity.wgsl
    ├── splat.wgsl
    └── render.wgsl
```

### 9.1 config.js 集中参数

```javascript
export const CONFIG = {
  // 模拟参数
  JACOBI_ITERATIONS:  20,
  VORTICITY_STRENGTH: 0.35,
  VELOCITY_DISSIPATION: 0.98,    // 每帧速度衰减系数
  DYE_DISSIPATION:      0.97,    // 每帧染料衰减系数
  SPLAT_RADIUS:         0.03,    // 高斯点半径（网格比例）
  SPLAT_FORCE:          5.0,     // 速度注入力度系数
  MAX_VELOCITY:         10.0,    // 速度场最大值 clamp

  // 时间步长
  DT_MIN: 1/120,   // 8.3ms
  DT_MAX: 1/30,    // 33.3ms

  // 初始化超时
  INIT_TIMEOUT_MS: 5000,

  // 设备像素比上限
  MAX_DPR: 2,

  // 低帧率自适应降级阈值
  LOW_FPS_THRESHOLD: 25,       // fps 低于此值连续 3 帧则降级
  LOW_FPS_JACOBI:    10,       // 降级后的 Jacobi 迭代次数
};
```

---

## 10. 部署配置

### 10.1 nginx-site.conf

```nginx
server {
    listen 443 ssl;
    server_name fluid.liaolief.com;  # 域名待定，占位

    ssl_certificate     /etc/letsencrypt/live/liaolief.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/liaolief.com/privkey.pem;

    root /var/www/webgpu-fluid/dist;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_types
        text/plain
        text/css
        application/javascript
        application/json
        text/plain;  # .wgsl 文件以 text/plain 提供，也被 gzip

    # MIME type：.wgsl 文件
    types {
        text/plain  wgsl;
    }

    # 路由规则
    location / {
        try_files $uri $uri/ /index.html;

        # HTML：不缓存
        location ~* \.html$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        # JS / CSS / WGSL：长缓存（Vite 构建带 content hash）
        location ~* \.(js|css|wgsl)$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
        }
    }
}

# HTTP → HTTPS 跳转
server {
    listen 80;
    server_name fluid.liaolief.com;
    return 301 https://$host$request_uri;
}
```

**说明**：
- WebGPU 要求 Secure Context（HTTPS），HTTP 访问必须重定向
- `.wgsl` 文件设为 `text/plain`（无专用 MIME type，text/plain 被浏览器接受作为 fetch 文本）
- Vite 构建输出文件名含 content hash，可安全使用 `immutable` 缓存
- 本项目不使用 SharedArrayBuffer，无需 COOP/COEP 头（`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`）

### 10.2 Vite 配置

```javascript
// vite.config.js
export default {
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,        // shader 文件不内联，保持独立文件
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  assetsInclude: ['**/*.wgsl'],  // 将 .wgsl 视为静态资源（?raw 导入方式）
};
```

**Shader 加载方式**：

```javascript
// fluid-sim.js 中
import advectWGSL from '../shaders/advect.wgsl?raw';
// Vite 将 ?raw 处理为字符串，构建时内联到 JS chunk 中
const shaderModule = device.createShaderModule({ code: advectWGSL });
```

---

## 11. 验收标准映射

| PRD AC | 代码测试点 | 测试方法 |
|--------|-----------|---------|
| AC-F1：Chrome 113+ Canvas 正常显示 | `webgpu-init.js` 返回有效 `{ device, context, canvasFormat }` | Chrome 113+ 打开，控制台无报错，canvas 可见 |
| AC-F1：不支持浏览器显示提示页 | `main.js` catch → `showUnsupportedPage()` | Firefox / 旧 Safari 打开，显示 `#unsupported`，canvas 隐藏 |
| AC-F1：初始化过程不白屏 | `index.html` body 背景色 `#000`，`#loading` 初始可见 | 低速 4G 模拟，页面背景始终黑色 |
| AC-F2：静止时速度场趋向零 | `VELOCITY_DISSIPATION = 0.98`，无输入时每帧衰减 | 停止触控后 3s，速度场目视衰减至黑屏 |
| AC-F2：点击后涟漪 2-3s 衰减 | `DYE_DISSIPATION = 0.97`，约 60×ln(100)/(-ln(0.97)) ≈ 153 帧 ≈ 2.6s | 单击后目视计时 |
| AC-F2：不出现 NaN/Inf | `MAX_VELOCITY = 10.0` clamp，advect 使用半拉格朗日（天然稳定）| 连续快速滑动 10 秒，画面不崩溃 |
| AC-F2：移动端 ≥ 30fps | dt clamp + 分辨率自适应 | Chrome DevTools 移动模拟 + FPS 显示（DEV 模式）|
| AC-F3：涟漪方向一致 | `touch-handler.js` dx/dy 计算方向正确 | 向右滑动，涟漪向右扩散 |
| AC-F3：双指同时触控 | `event.touches` 全量处理，max 10 splat | 双指点击，两个涟漪同时出现 |
| AC-F3：5 指同时触控 | `SplatList.count` 最大 10，不截断 | 5 指同时触控，5 个涟漪出现 |
| AC-F3：桌面鼠标按住拖动 | `mouseDown` 状态门控 + `mouseleave` 清除 | Chrome 桌面，按住拖动产生涟漪，松开停止 |
| AC-F4：静止暗色，触控区域变亮 | `brightness = pow(min(mag*3, 1), 0.6)`，零速度 → 零亮度 | 目视检查 |
| AC-F4：蓝绿色调 + 白色高光 | render.wgsl `baseHue=195`，highlight 叠加 | 目视检查 |
| AC-F4：Canvas 全屏无黑边 | `canvas { position:fixed; width:100vw; height:100vh }` | 目视检查，旋转屏幕 |
| AC-F5：提示页列出推荐浏览器 | HTML 静态内容，见 UI_SPEC §5.7 | 目视检查 |
| AC-F5：视觉风格一致 | 背景 `#000000`，色调与主体验一致 | 目视检查 |
| AC-F5：无技术错误信息 | 生产模式只 `console.warn`，不渲染 error 到 DOM | 生产构建后打开不支持的浏览器 |
| AC-F6：Nginx 语法检查 | `nginx-site.conf` 语法正确 | `nginx -t` 通过 |
| AC-F6：HTTP → HTTPS | server block 80 端口 return 301 | curl -I http://... 检查响应码 |
| AC-F6：Gzip 正确 | `gzip_types` 包含 `application/javascript` | curl -H "Accept-Encoding: gzip" 检查 Content-Encoding |
| AC-F6：.wgsl MIME type | `types { text/plain wgsl; }` | curl -I 检查 Content-Type |

---

## 12. 调试辅助（开发模式专用）

### 12.1 debugValueBuffer

用于将 GPU 中间值读回 CPU 检查（对应 PRD 风险 3 缓解方案）：

```javascript
// 创建一个 MAP_READ buffer，大小 = 4 floats
const debugBuf = device.createBuffer({
  size: 4 * 4,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

// 在 compute pass 后，copyTextureToBuffer 读取指定像素
encoder.copyTextureToBuffer(
  { texture: divergenceTex, origin: [gridW/2, gridH/2, 0] },
  { buffer: debugBuf, bytesPerRow: 256 },  // bytesPerRow 必须 ≥ 256（WebGPU 限制）
  [1, 1, 1]
);

// 提交并映射
device.queue.submit([encoder.finish()]);
await debugBuf.mapAsync(GPUMapMode.READ);
const data = new Float32Array(debugBuf.getMappedRange());
console.log('divergence center:', data[0]);
debugBuf.unmap();
```

### 12.2 各 Pass 独立验证顺序

按风险 3 缓解方案，建议实现顺序：

1. 实现 splat pass → 验证速度注入可视化（先用简单颜色渲染速度场）
2. 实现 advect velocity → 验证速度场平滑移动
3. 实现 divergence + pressure + gradient_subtract → 验证速度场趋于无散度
4. 实现 vorticity → 验证涡旋增强
5. 实现 dye advect + 最终 render → 完整视觉效果

---

**文档结束**  
下一步：按 §9 文件结构创建项目骨架，从 `webgpu-init.js` 开始逐模块实现。
