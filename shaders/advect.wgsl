// advect.wgsl
// 半拉格朗日对流 - 速度场 self-advect + dye advect
// 手动双线性插值（rg32float / rgba16float 不支持 filterable sampler）
//
// 两个 entry points 在同一文件中，各自使用独立的绑定集合：
//   advect_velocity: @group(0) binding 0,1,2
//   advect_dye:      @group(1) binding 0,1,2,3
//
// 注意：两个 entry point 使用不同的 group(0)/group(1) 来避免
//   同一 module 中 @group/@binding 对冲突（WGSL 规范要求唯一）
//   CPU 侧分别用 group(0) setBindGroup(0,...) 和 group(1) setBindGroup(1,...)

struct SimParams {
  dt:           f32,   // offset 0
  rdx:          f32,   // offset 4
  texelSize:    vec2f, // offset 8
  gridSize:     vec2f, // offset 16
  splatRadius:  f32,   // offset 24
  vorticityStr: f32,   // offset 28
  dissipation:  f32,   // offset 32
  dyeDissip:    f32,   // offset 36
  _pad0:        f32,   // offset 40
  _pad1:        f32,   // offset 44
}

// ─────────────────────────────────────────────
// 辅助函数：边界 clamp
// ─────────────────────────────────────────────

fn clampCoord(c: vec2i, size: vec2i) -> vec2i {
  return clamp(c, vec2i(0), size - vec2i(1));
}

// ─────────────────────────────────────────────
// 双线性插值：rg32float（速度场，返回 vec2f）
// ─────────────────────────────────────────────
fn bilinear_rg(
  tex: texture_storage_2d<rg32float, read>,
  pos: vec2f,
  size: vec2i
) -> vec2f {
  // 转到以左下角为原点的坐标（像素中心 = +0.5）
  let p = pos - vec2f(0.5);
  let i = vec2i(floor(p));
  let f = fract(p);

  let c00 = clampCoord(i,               size);
  let c10 = clampCoord(i + vec2i(1, 0), size);
  let c01 = clampCoord(i + vec2i(0, 1), size);
  let c11 = clampCoord(i + vec2i(1, 1), size);

  let v00 = textureLoad(tex, c00).xy;
  let v10 = textureLoad(tex, c10).xy;
  let v01 = textureLoad(tex, c01).xy;
  let v11 = textureLoad(tex, c11).xy;

  let top    = mix(v00, v10, f.x);
  let bottom = mix(v01, v11, f.x);
  return mix(top, bottom, f.y);
}

// ─────────────────────────────────────────────
// 双线性插值：rgba16float（染料场，返回 vec4f）
// ─────────────────────────────────────────────
fn bilinear_rgba(
  tex: texture_storage_2d<rgba16float, read>,
  pos: vec2f,
  size: vec2i
) -> vec4f {
  let p = pos - vec2f(0.5);
  let i = vec2i(floor(p));
  let f = fract(p);

  let c00 = clampCoord(i,               size);
  let c10 = clampCoord(i + vec2i(1, 0), size);
  let c01 = clampCoord(i + vec2i(0, 1), size);
  let c11 = clampCoord(i + vec2i(1, 1), size);

  let v00 = textureLoad(tex, c00);
  let v10 = textureLoad(tex, c10);
  let v01 = textureLoad(tex, c01);
  let v11 = textureLoad(tex, c11);

  let top    = mix(v00, v10, f.x);
  let bottom = mix(v01, v11, f.x);
  return mix(top, bottom, f.y);
}

// ═════════════════════════════════════════════
// Entry Point 1: advect_velocity
// 速度场自我对流
// Bind group layout:
//   @group(0) @binding(0) SimParams (uniform)
//   @group(0) @binding(1) velIn     (rg32float, read)
//   @group(0) @binding(2) velOut    (rg32float, write)
// ═════════════════════════════════════════════

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var velIn:  texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var velOut: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(16, 16, 1)
fn advect_velocity(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params.gridSize.x), i32(params.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 当前像素中心浮点坐标（像素空间）
  let posF = vec2f(coord) + vec2f(0.5);

  // 读取当前速度
  let vel = textureLoad(velIn, coord).xy;

  // 半拉格朗日回溯：上一帧位置（像素坐标）
  let prevPos = posF - vel * params.dt * params.rdx;

  // 手动双线性采样 + 耗散
  let result = bilinear_rg(velIn, prevPos, size) * params.dissipation;

  textureStore(velOut, coord, vec4f(result, 0.0, 0.0));
}

// ═════════════════════════════════════════════
// Entry Point 2: advect_dye
// 染料场对流（沿速度场）
// Bind group layout:
//   @group(1) @binding(0) SimParams  (uniform)
//   @group(1) @binding(1) velIn      (rg32float, read)
//   @group(1) @binding(2) dyeIn      (rgba16float, read)
//   @group(1) @binding(3) dyeOut     (rgba16float, write)
//
// 注意：advect_dye 使用 @group(1) 绑定以避免与 advect_velocity 的 @group(0) 冲突
// （WGSL 同一 module 中相同 @group/@binding 不能出现两次不同类型）。
// CPU 侧为 advect_dye pass 调用 setBindGroup(1, ...) 绑定。
// ═════════════════════════════════════════════

@group(1) @binding(0) var<uniform> params_dye: SimParams;
@group(1) @binding(1) var velIn_dye: texture_storage_2d<rg32float, read>;
@group(1) @binding(2) var dyeIn:     texture_storage_2d<rgba16float, read>;
@group(1) @binding(3) var dyeOut:    texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16, 1)
fn advect_dye(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params_dye.gridSize.x), i32(params_dye.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 当前像素中心浮点坐标
  let posF = vec2f(coord) + vec2f(0.5);

  // 读取当前速度（从速度场）
  let vel = textureLoad(velIn_dye, coord).xy;

  // 半拉格朗日回溯
  let prevPos = posF - vel * params_dye.dt * params_dye.rdx;

  // 双线性采样染料场，乘以染料耗散系数
  let result = bilinear_rgba(dyeIn, prevPos, size) * params_dye.dyeDissip;

  textureStore(dyeOut, coord, result);
}
