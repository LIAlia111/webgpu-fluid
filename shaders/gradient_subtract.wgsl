// gradient_subtract.wgsl
// 从速度场中减去压力梯度，使速度满足不可压缩约束 ∇·u = 0
// 边界像素强制设为 (0,0)（no-slip 边界条件）

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
@group(0) @binding(1) var pressure:    texture_storage_2d<r32float, read>;
@group(0) @binding(2) var velocityIn:  texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var velocityOut: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params.gridSize.x), i32(params.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 边界像素：no-slip，速度强制为零
  if (coord.x == 0 || coord.x == size.x - 1 ||
      coord.y == 0 || coord.y == size.y - 1) {
    textureStore(velocityOut, coord, vec4f(0.0, 0.0, 0.0, 0.0));
    return;
  }

  // 内部像素：读取 4 邻域压力
  let pL = textureLoad(pressure, coord + vec2i(-1,  0)).r;
  let pR = textureLoad(pressure, coord + vec2i( 1,  0)).r;
  let pD = textureLoad(pressure, coord + vec2i( 0, -1)).r;
  let pU = textureLoad(pressure, coord + vec2i( 0,  1)).r;

  // 压力梯度（中心差分）
  let gradP = vec2f(pR - pL, pU - pD) * 0.5 * params.rdx;

  // 当前速度 - 压力梯度
  let vel = textureLoad(velocityIn, coord).xy;
  let newVel = vel - gradP;

  textureStore(velocityOut, coord, vec4f(newVel, 0.0, 0.0));
}
