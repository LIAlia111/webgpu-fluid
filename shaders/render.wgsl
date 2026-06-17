// render.wgsl
// 全屏 quad 渲染：dye 场 → 屏幕颜色
// 顶点 shader：无顶点 buffer，built-in vertex_index 生成全屏 quad（6 个顶点）
// 片元 shader：textureSample + HSL 颜色映射（深蓝→青→白）

// ─────────────────────────────────────────────
// Uniforms
// ─────────────────────────────────────────────

struct RenderParams {
  screenSize: vec2f,
  _pad:       vec2f,
}

// ─────────────────────────────────────────────
// Bindings
// ─────────────────────────────────────────────

@group(0) @binding(0) var dyeTex: texture_2d<f32>;
@group(0) @binding(1) var samp:   sampler;
@group(0) @binding(2) var<uniform> renderParams: RenderParams;

// ─────────────────────────────────────────────
// Vertex / Fragment IO
// ─────────────────────────────────────────────

struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

// ─────────────────────────────────────────────
// 辅助：HSL → RGB 转换
// h: [0, 360]，s: [0, 1]，l: [0, 1]
// 返回 vec3f RGB in [0, 1]
// ─────────────────────────────────────────────
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs(h6 % 2.0 - 1.0));
  let m = l - c * 0.5;

  var rgb: vec3f;
  if (h6 < 1.0) {
    rgb = vec3f(c, x, 0.0);
  } else if (h6 < 2.0) {
    rgb = vec3f(x, c, 0.0);
  } else if (h6 < 3.0) {
    rgb = vec3f(0.0, c, x);
  } else if (h6 < 4.0) {
    rgb = vec3f(0.0, x, c);
  } else if (h6 < 5.0) {
    rgb = vec3f(x, 0.0, c);
  } else {
    rgb = vec3f(c, 0.0, x);
  }

  return rgb + vec3f(m);
}

// ─────────────────────────────────────────────
// Vertex Shader
// 生成全屏 quad（2 个三角形，6 个顶点，无顶点 buffer）
//
// 顶点索引 → NDC 坐标 → UV 坐标
//
// 三角形 1: 0,1,2  三角形 2: 3,4,5
//
// vi=0: NDC(-1,-1) UV(0,1)
// vi=1: NDC( 1,-1) UV(1,1)
// vi=2: NDC(-1, 1) UV(0,0)
// vi=3: NDC(-1, 1) UV(0,0)
// vi=4: NDC( 1,-1) UV(1,1)
// vi=5: NDC( 1, 1) UV(1,0)
//
// NDC Y 轴朝上，纹理 UV Y 轴朝下，因此 uv.y = 1.0 - ndc_y * 0.5 - 0.5
// ─────────────────────────────────────────────
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // 查找表：6 个顶点的 NDC XY
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),   // 0: 左下
    vec2f( 1.0, -1.0),   // 1: 右下
    vec2f(-1.0,  1.0),   // 2: 左上
    vec2f(-1.0,  1.0),   // 3: 左上（三角形 2 起点）
    vec2f( 1.0, -1.0),   // 4: 右下
    vec2f( 1.0,  1.0),   // 5: 右上
  );

  let ndcPos = positions[vi];

  // UV：x = (ndcX + 1) / 2，y 翻转：uv.y = 1 - (ndcY + 1) / 2
  let uv = vec2f(
    (ndcPos.x + 1.0) * 0.5,
    1.0 - (ndcPos.y + 1.0) * 0.5
  );

  var out: VertexOutput;
  out.pos = vec4f(ndcPos, 0.0, 1.0);
  out.uv  = uv;
  return out;
}

// ─────────────────────────────────────────────
// Fragment Shader
// 颜色映射：深蓝→青→白（速度由弱到强）
// ─────────────────────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let dye = textureSample(dyeTex, samp, in.uv);

  // dye.rgb 存储染料颜色（由 splat 注入时设置，对流传播）
  // 用 dye.rg 的向量大小模拟"速度强度感"
  let mag = length(dye.rg);

  // 亮度：非线性映射，让低速度区域保持暗色
  let brightness = pow(min(mag * 3.0, 1.0), 0.6);

  // 色调：以青蓝 195° 为基础，根据方向小幅偏移（+/-15°）
  let baseHue = 195.0;
  let dir = atan2(dye.g, dye.r);   // [-π, π]
  let hue = baseHue + dir * 15.0 / 3.14159;

  // 主颜色：HSL → RGB
  let color = hsl_to_rgb(hue, 0.85, brightness * 0.55 + 0.02);

  // 速度梯度高光（边缘增强）
  let gradient = length(vec2f(dpdx(mag), dpdy(mag)));
  let highlight = smoothstep(0.3, 1.0, gradient) * brightness;

  // 最终颜色：背景纯黑（dye=0 时 brightness=0，color=near-zero）
  let finalColor = color + vec3f(highlight * 0.8);

  return vec4f(finalColor, 1.0);
}
