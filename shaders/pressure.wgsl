// pressure.wgsl
// Jacobi 迭代单步，求解压力泊松方程 ∇²p = div
// p_new[i,j] = (p[i-1,j] + p[i+1,j] + p[i,j-1] + p[i,j+1] - div[i,j]) / 4
// CPU 侧循环 20 次，每次交换 ping-pong buffer

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

@group(0) @binding(0) var<uniform> params:      SimParams;
@group(0) @binding(1) var pressureIn:  texture_storage_2d<r32float, read>;
@group(0) @binding(2) var divergence:  texture_storage_2d<r32float, read>;
@group(0) @binding(3) var pressureOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params.gridSize.x), i32(params.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 4 邻域压力值（边界 clamp）
  let pL = textureLoad(pressureIn, clampCoord(coord + vec2i(-1,  0), size)).r;
  let pR = textureLoad(pressureIn, clampCoord(coord + vec2i( 1,  0), size)).r;
  let pD = textureLoad(pressureIn, clampCoord(coord + vec2i( 0, -1), size)).r;
  let pU = textureLoad(pressureIn, clampCoord(coord + vec2i( 0,  1), size)).r;

  // 当前散度
  let div = textureLoad(divergence, coord).r;

  // Jacobi 单步
  let p_new = (pL + pR + pD + pU - div) * 0.25;

  textureStore(pressureOut, coord, vec4f(p_new, 0.0, 0.0, 0.0));
}
