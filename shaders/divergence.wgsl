// divergence.wgsl
// 计算速度场散度 div = ∂u/∂x + ∂v/∂y
// 中心差分，4 邻域，边界 clamp（Neumann 边界条件）

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

fn clampCoord(c: vec2i, size: vec2i) -> vec2i {
  return clamp(c, vec2i(0), size - vec2i(1));
}

@group(0) @binding(0) var<uniform> params:  SimParams;
@group(0) @binding(1) var velocity: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var outDiv:   texture_storage_2d<r32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params.gridSize.x), i32(params.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 4 邻域（边界 clamp）
  let L = textureLoad(velocity, clampCoord(coord + vec2i(-1,  0), size)).xy;
  let R = textureLoad(velocity, clampCoord(coord + vec2i( 1,  0), size)).xy;
  let D = textureLoad(velocity, clampCoord(coord + vec2i( 0, -1), size)).xy;
  let U = textureLoad(velocity, clampCoord(coord + vec2i( 0,  1), size)).xy;

  // 中心差分：div = (∂u/∂x + ∂v/∂y) * 0.5 * rdx
  let div = (R.x - L.x + U.y - D.y) * 0.5 * params.rdx;

  textureStore(outDiv, coord, vec4f(div, 0.0, 0.0, 0.0));
}
