# Task 003: WGSL Shader 文件（全部 7 个）

## 依赖
Design Doc §4

## 产物
- /root/lief-projects/webgpu-fluid/shaders/advect.wgsl
- /root/lief-projects/webgpu-fluid/shaders/divergence.wgsl
- /root/lief-projects/webgpu-fluid/shaders/pressure.wgsl
- /root/lief-projects/webgpu-fluid/shaders/gradient_subtract.wgsl
- /root/lief-projects/webgpu-fluid/shaders/vorticity.wgsl
- /root/lief-projects/webgpu-fluid/shaders/splat.wgsl
- /root/lief-projects/webgpu-fluid/shaders/render.wgsl

## SimParams struct（所有 compute shader 共用）
```wgsl
struct SimParams {
  dt:           f32,
  rdx:          f32,
  texelSize:    vec2f,
  gridSize:     vec2f,
  splatRadius:  f32,
  vorticityStr: f32,
  dissipation:  f32,
  dyeDissip:    f32,
  _pad0:        f32,
  _pad1:        f32,
}
```

## Workgroup 尺寸（所有 compute shader）
@workgroup_size(16, 16, 1)
越界检查：if coord.x >= gridSize.x || coord.y >= gridSize.y { return; }

## 关键实现要求

### advect.wgsl
- 两个 entry points：advect_velocity 和 advect_dye
- 手动双线性插值（不用 textureSample，rg32float 不支持 filterable）
- binding: 0=SimParams, 1=velocityRead(rg32float/read), 2=fieldRead, 3=fieldWrite
- 半拉格朗日：prevPos = coord - vel * dt * rdx，双线性采样

### divergence.wgsl
- 中心差分：div = (R.x - L.x + U.y - D.y) * 0.5 * rdx
- binding: 0=SimParams, 1=velocity(rg32float/read), 2=outDiv(r32float/write)

### pressure.wgsl
- Jacobi 单步：p_new = (pL + pR + pD + pU - div) * 0.25
- binding: 0=SimParams, 1=pressureIn(r32float/read), 2=divergence(r32float/read), 3=pressureOut(r32float/write)

### gradient_subtract.wgsl
- u = u - 0.5 * rdx * (pR - pL, pU - pD)
- 边界强制为 (0,0)（no-slip）
- binding: 0=SimParams, 1=pressure(r32float/read), 2=velocityIn(rg32float/read), 3=velocityOut(rg32float/write)

### vorticity.wgsl
- Entry 1 compute_curl：curl = (U.x - D.x - R.y + L.y) * 0.5 * rdx
- Entry 2 apply_confinement：N = normalize(grad|curl|), force = vorticityStr * cross(N, curl)
- curl binding: 0=SimParams, 1=velocity(read), 2=outCurl(r32float/write)
- confinement binding: 0=SimParams, 1=curlTex(read), 2=velocityIn(read), 3=velocityOut(write)

### splat.wgsl
- SplatData: uv(vec2f) + velocity(vec2f) + color(vec3f) + radius(f32) = 32 bytes
- SplatList: count(u32) + _pad(3×u32) + splats(array<SplatData,10>)
- 高斯分布：exp(-dist²/(2*r²)) * velocity
- 最大速度 clamp：MAX_VELOCITY = 10.0
- binding: 0=SimParams, 1=splatList(uniform), 2=velocityInOut(rg32float/read_write), 3=dyeInOut(rgba16float/read_write)

### render.wgsl
- 顶点 shader：无顶点 buffer，built-in vertex_index 生成全屏 quad（draw 6 vertices）
- 片元 shader：textureSample(dyeTex, samp, uv)，颜色映射：速度大小 → 青蓝渐变
- hsl_to_rgb 辅助函数（WGSL 无内置 HSL）
- binding: 0=dyeTex(texture_2d<f32>), 1=samp(sampler), 2=renderParams(uniform, screenSize: vec2f)

## 验收标准
- 所有 shader 编译无错误（device.createShaderModule 不报错）
- advect 手动双线性插值正确（避免 float32-filterable 依赖）
- render.wgsl 颜色方案：深蓝→青→白（速度由弱到强）
