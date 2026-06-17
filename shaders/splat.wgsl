// splat.wgsl
// 高斯点注入：将触控/鼠标输入以高斯分布注入速度场和染料场
// 支持每帧最多 10 个 splat 并行处理
// ping-pong 版本（iOS WebGPU 不支持 read_write storage texture）

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

// SplatData：32 bytes，WGSL uniform 对齐规则：
//   uv:       vec2f  @ offset 0  (8 bytes)
//   velocity: vec2f  @ offset 8  (8 bytes)
//   color:    vec3f  @ offset 16 (12 bytes，vec3f 对齐到 16 但只占 12)
//   radius:   f32    @ offset 28 (4 bytes)
//   total = 32 bytes ✓
struct SplatData {
  uv:       vec2f,
  velocity: vec2f,
  color:    vec3f,
  radius:   f32,
}

// SplatList：16 bytes header + 10 × 32 bytes = 336 bytes
struct SplatList {
  count:  u32,
  _pad0:  u32,
  _pad1:  u32,
  _pad2:  u32,
  splats: array<SplatData, 10>,
}

@group(0) @binding(0) var<uniform> params:    SimParams;
@group(0) @binding(1) var<uniform> splatList: SplatList;
@group(0) @binding(2) var velocityIn:  texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var velocityOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var dyeIn:       texture_storage_2d<rgba16float, read>;
@group(0) @binding(5) var dyeOut:      texture_storage_2d<rgba16float, write>;

const MAX_VELOCITY: f32 = 10.0;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let gridSizeI = vec2i(i32(params.gridSize.x), i32(params.gridSize.y));
  if (coord.x >= gridSizeI.x || coord.y >= gridSizeI.y) { return; }

  // 当前像素的归一化 UV 坐标（0..1）
  let texcoord = (vec2f(coord) + vec2f(0.5)) * params.texelSize;

  // 累积速度和染料贡献
  var accumVel = vec2f(0.0);
  var accumDye = vec4f(0.0);

  for (var i: u32 = 0u; i < splatList.count; i++) {
    let s = splatList.splats[i];
    let diff = texcoord - s.uv;
    let r = max(s.radius, 0.001);
    let distSq = dot(diff, diff);
    let factor = exp(-distSq / (2.0 * r * r));
    accumVel += factor * s.velocity;
    accumDye += factor * vec4f(s.color, 1.0);
  }

  let oldVel = textureLoad(velocityIn, coord).xy;
  let newVel = clamp(oldVel + accumVel, vec2f(-MAX_VELOCITY), vec2f(MAX_VELOCITY));
  textureStore(velocityOut, coord, vec4f(newVel, 0.0, 0.0));

  let oldDye = textureLoad(dyeIn, coord);
  let newDye = saturate(oldDye + accumDye);
  textureStore(dyeOut, coord, newDye);
}
