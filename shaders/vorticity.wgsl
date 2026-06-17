// vorticity.wgsl
// 两个 entry points：
//   compute_curl        — 计算涡量标量 ω = ∂v/∂x - ∂u/∂y
//   apply_confinement   — 涡旋增强力注入速度场（Fedkiw 2001 简化版）

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

// ═════════════════════════════════════════════
// Entry Point 1: compute_curl
// ω = ∂v/∂x - ∂u/∂y  （2D 涡量 z 分量）
// ═════════════════════════════════════════════

@group(0) @binding(0) var<uniform> params_curl: SimParams;
@group(0) @binding(1) var velocity_curl: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var outCurl:       texture_storage_2d<r32float, write>;

@compute @workgroup_size(16, 16, 1)
fn compute_curl(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params_curl.gridSize.x), i32(params_curl.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 4 邻域速度（边界 clamp）
  let vL = textureLoad(velocity_curl, clampCoord(coord + vec2i(-1,  0), size)).xy;
  let vR = textureLoad(velocity_curl, clampCoord(coord + vec2i( 1,  0), size)).xy;
  let vD = textureLoad(velocity_curl, clampCoord(coord + vec2i( 0, -1), size)).xy;
  let vU = textureLoad(velocity_curl, clampCoord(coord + vec2i( 0,  1), size)).xy;

  // curl = (∂v/∂x - ∂u/∂y) * 0.5 * rdx
  // ∂v/∂x ≈ (vR.y - vL.y) / (2*dx)
  // ∂u/∂y ≈ (vU.x - vD.x) / (2*dy)
  // 注：任务说明中公式 curl = (U.x - D.x - R.y + L.y) * 0.5 * rdx
  //     即 -(∂u/∂y) + (∂v/∂x) 展开为 (vU.x - vD.x - vR.y + vL.y)，符号等价
  let curl = (vU.x - vD.x - vR.y + vL.y) * 0.5 * params_curl.rdx;

  textureStore(outCurl, coord, vec4f(curl, 0.0, 0.0, 0.0));
}

// ═════════════════════════════════════════════
// Entry Point 2: apply_confinement
// 涡旋增强力：F = ε × (N × ω)（2D 叉积）
// N = normalize( ∇|ω| )，指向涡量增大方向
// ═════════════════════════════════════════════

@group(0) @binding(0) var<uniform> params_conf: SimParams;
@group(0) @binding(1) var curlTex:     texture_storage_2d<r32float, read>;
@group(0) @binding(2) var velocityIn:  texture_storage_2d<rg32float, read>;
@group(0) @binding(3) var velocityOut: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(16, 16, 1)
fn apply_confinement(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(i32(id.x), i32(id.y));
  let size  = vec2i(i32(params_conf.gridSize.x), i32(params_conf.gridSize.y));

  if (coord.x >= size.x || coord.y >= size.y) { return; }

  // 读取当前涡量及 4 邻域的涡量绝对值
  let curl_C = textureLoad(curlTex, coord).r;
  let curl_L = abs(textureLoad(curlTex, clampCoord(coord + vec2i(-1,  0), size)).r);
  let curl_R = abs(textureLoad(curlTex, clampCoord(coord + vec2i( 1,  0), size)).r);
  let curl_D = abs(textureLoad(curlTex, clampCoord(coord + vec2i( 0, -1), size)).r);
  let curl_U = abs(textureLoad(curlTex, clampCoord(coord + vec2i( 0,  1), size)).r);

  // 涡量梯度（指向涡量增大方向）
  // N = normalize(vec2(|ω_U| - |ω_D|, |ω_R| - |ω_L|) + ε)
  let grad = vec2f(curl_U - curl_D, curl_R - curl_L);
  let N = normalize(grad + vec2f(1e-5));

  // confinement force = ε × (N × ω)（2D 叉积展开）
  // 2D 中 N×ω = (N.y * ω, -N.x * ω)
  let force = params_conf.vorticityStr * vec2f(N.y * curl_C, -N.x * curl_C);

  // 更新速度
  let vel = textureLoad(velocityIn, coord).xy;
  let newVel = vel + force * params_conf.dt;

  textureStore(velocityOut, coord, vec4f(newVel, 0.0, 0.0));
}
