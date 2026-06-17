# Task 004: 流体模拟核心

## 依赖
Phase 2（webgpu-init.js）+ Phase 3（所有 .wgsl）

## 产物
- /root/lief-projects/webgpu-fluid/src/fluid-sim.js

## 类接口
export class FluidSim {
  async init(device, context, canvasFormat, canvas)
  step(dt, splats)
  handleResize(canvas)
  destroy()
}

## CONFIG 常量
JACOBI_ITERATIONS: 20
VORTICITY_STRENGTH: 0.35
VELOCITY_DISSIPATION: 0.98
DYE_DISSIPATION: 0.97
SPLAT_RADIUS: 0.03
SPLAT_FORCE: 5.0
MAX_VELOCITY: 10.0

## DoubleBuffer 类
ping/pong 两个 GPUTexture
read/write getter 基于 readIdx 切换
swap() 切换 readIdx
destroy() 销毁两个纹理

## 纹理规格
velocity: DoubleBuffer, rg32float（速度场 x+y 打包）
pressure: DoubleBuffer, r32float
divergence: 单纹理, r32float
vortCurl: 单纹理, r32float
dye: DoubleBuffer, rgba16float

TEX_USAGE = TEXTURE_BINDING | STORAGE_BINDING

## Shader 加载（无 Vite）
用 fetch('/webgpu-fluid/shaders/name.wgsl') 加载文本
device.createShaderModule({ code: text })

## computeGridSize()
screen.width <= 768 ? maxDim = 256 : maxDim = 512
w = min(maxDim, floor(innerWidth/4))，对齐到 16 的倍数
h = min(maxDim, floor(innerHeight/4))，对齐到 16 的倍数

## SimParams Uniform 布局（48 bytes）
float[0]: dt
float[1]: rdx = 1.0
float[2]: texelSize.x = 1/gridW
float[3]: texelSize.y = 1/gridH
float[4]: gridSize.x
float[5]: gridSize.y
float[6]: splatRadius
float[7]: vorticityStr
float[8]: dissipation
float[9]: dyeDissipation
float[10-11]: padding

## step() 执行顺序
1. updateSimParams(dt)
2. updateSplatBuffer(splats)
3. createCommandEncoder
4. splat pass（compute）
5. advect velocity pass（compute）
6. divergence pass（compute）
7. Jacobi 循环（20次）：pressure pass + pressure.swap()
8. gradient subtract pass（compute）
9. curl pass（compute）
10. confinement pass（compute）
11. advect dye pass（compute）
12. render pass（render）
13. queue.submit
14. velocity.swap(); dye.swap()（pressure 在 Jacobi 内已 swap）

## Bind Group 预创建策略
init() 时为每个 pass 预创建两套 bind group（ping-as-read 和 pong-as-read）
step() 时根据 DoubleBuffer.readIdx 选择对应 bind group

## SplatList Buffer 布局（336 bytes）
offset 0: count (u32)
offset 4-15: padding (3×u32)
offset 16+i×32: SplatData[i] (uv:vec2f + velocity:vec2f + color:vec3f + radius:f32)

## 低帧率降级
连续 3 帧 dt > 1/25 时，Jacobi 降为 10 次

## 验收标准
- 触控后速度场产生涟漪
- 静止 3s 后速度场衰减到接近 0
- GPU 内存 < 15MB（512×512 配置）
- 快速操作 10s 无崩溃
