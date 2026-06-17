# UI Spec: WebGPU 流体涟漪 Demo

**版本**：v1.0  
**日期**：2026-05-21  
**对应 PRD**：PRD v1.0  
**状态**：待实现

---

## 1. 整体布局

### 1.1 布局原则

纯沉浸式全屏体验，无任何 UI 控件遮挡画面。页面只有两种状态：

- **主体验状态**：全屏 Canvas，零 UI 元素
- **不兼容状态**：全屏提示页，替代 Canvas

### 1.2 Canvas 尺寸

```
┌─────────────────────────────────────┐
│                                     │  ← viewport 100vw × 100vh
│                                     │
│          WebGPU Canvas              │
│        (流体模拟渲染区域)             │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

- **CSS 尺寸**：`width: 100vw; height: 100vh`
- **position**：`fixed; top: 0; left: 0`
- **内部分辨率**：`window.innerWidth × devicePixelRatio`（DPR 最大取 2）
- **overflow**：`hidden`（body 级别，防止滚动条出现）
- **margin/padding**：全零（body reset）

### 1.3 iOS Safe Area 处理

iOS 底部导航条（Home Indicator）和顶部刘海需要处理，但 Canvas 仍然全屏覆盖，不因 safe area 缩小：

```css
/* HTML/body 设置 */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000000;
}

/* Canvas 全屏覆盖，穿透 safe area */
canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: block;
}
```

```html
<!-- viewport meta 设置 -->
<meta name="viewport"
  content="width=device-width, initial-scale=1.0,
           viewport-fit=cover,
           user-scalable=no">
```

- `viewport-fit=cover`：Canvas 延伸到 safe area 区域内（沉浸感优先）
- `user-scalable=no`：禁止双指缩放，防止误触打断体验
- 底部 Home Indicator 半透明浮于 Canvas 上方，不影响渲染

---

## 2. 视觉效果规格

### 2.1 背景色

| 状态 | 颜色值 | 说明 |
|------|--------|------|
| 静止水面（无触控） | `#000000` | 纯黑，零速度场显示 |
| 初始化完成待触控 | `#000000` | 同上，进入等待状态 |
| 页面加载中 | `#000000` | 黑色背景防止白屏闪烁 |

### 2.2 水波颜色方案

基于速度场可视化，两层叠加：

#### 基础颜色映射（速度大小 → 亮度）

```
速度 magnitude = 0       →  #000000（纯黑，静止）
速度 magnitude = 低      →  #0a1628（深海蓝，微弱扰动）
速度 magnitude = 中      →  #1a4a6e（中蓝，扩散涟漪）
速度 magnitude = 高      →  #00c4e8（青蓝，活跃涟漪）
速度 magnitude = 极高    →  #ffffff（白色高光，触点中心）
```

渐变色阶（HSL 空间插值，从暗到亮）：

```
暗区：hsl(210, 80%, 5%)   → #010d19
中区：hsl(200, 75%, 25%)  → #0d4a63
亮区：hsl(190, 90%, 55%)  → #0ecce6
高光：hsl(0, 0%, 100%)    → #ffffff
```

#### 速度方向 → 色相偏移

在基础蓝绿色调上叠加方向色偏：

| 速度方向 | 色相偏移 | 视觉效果 |
|----------|----------|----------|
| 正 X（向右） | +15° 偏暖（青→绿）| `#00e8a0` 绿青 |
| 负 X（向左） | -15° 偏冷（青→蓝）| `#0050e8` 深蓝 |
| 正 Y（向下） | +10° 偏暖 | 轻微暖调 |
| 负 Y（向上） | -10° 偏冷 | 轻微冷调 |
| 旋涡区域 | 色相环绕，彩虹感 | 干涉纹区域多彩 |

#### 高光层（模拟水面反光）

- 基于速度场梯度（spatial gradient）计算法线偏移
- 高梯度区域叠加 `rgba(255, 255, 255, 0.3~0.8)` 白色高光
- 高光形状：涟漪波峰处出现细线状亮边

#### Fragment Shader 颜色公式（WGSL 伪代码）

```wgsl
let mag = length(velocity);          // 速度大小
let dir = atan2(velocity.y, velocity.x);  // 速度方向

// 基础亮度（非线性映射，突出低速区分）
let brightness = pow(min(mag * 3.0, 1.0), 0.6);

// 基础蓝绿色
let baseHue = 195.0;  // 青色
let hue = baseHue + dir * 15.0;  // 方向偏移

// 转 RGB（HSL → RGB）
let color = hsl_to_rgb(hue, 0.85, brightness * 0.55 + 0.02);

// 高光叠加
let gradient = length(vec2(dpdx(mag), dpdy(mag)));
let highlight = smoothstep(0.3, 1.0, gradient) * brightness;
let finalColor = color + vec3(highlight * 0.8);

return vec4(finalColor, 1.0);
```

### 2.3 视觉风格参考

目标效果描述（无需 3D 或光追）：

- **主基调**：深黑水面，涟漪区域发光，像暗室中被灯光照射的水波
- **颜色风格**：冷色调（蓝青为主），快速触控区域出现白色高光爆破感
- **干涉区域**：两个涟漪相遇时颜色叠加，出现彩虹干涉纹（色相环绕）
- **衰减感**：涟漪离触点越远越暗，最终消融入黑色背景

---

## 3. 触控交互规格

### 3.1 事件监听

```
触控设备：
  touchstart   → 记录新触点，开始注入速度场
  touchmove    → 更新触点位置，持续注入（含方向+速度）
  touchend     → 移除触点，注入停止，涟漪自然衰减
  touchcancel  → 同 touchend 处理

桌面设备：
  mousedown    → 标记拖动开始，记录初始位置
  mousemove    → 仅在 mousedown 激活状态下注入
  mouseup      → 结束拖动，停止注入
  mouseleave   → Canvas 外同 mouseup 处理（防止鼠标移出 Canvas 后按住状态残留）
```

### 3.2 多点触控规格

| 参数 | 值 | 说明 |
|------|----|------|
| 最大同时触点数 | 10 | 遍历 `event.touches` 全量，不设上限截断 |
| 触点 ID 追踪 | `touch.identifier` | 跨帧稳定追踪，不按 index 取 |
| 每帧处理 | 全量 `event.changedTouches` | 移动事件取增量，提升性能 |
| 触点历史 | 保存上一帧位置（per touch ID）| 用于计算速度向量 |

### 3.3 速度场注入参数

| 参数 | 值 | 说明 |
|------|----|------|
| 扰动半径 | 网格尺寸 × 3%（256 网格 ≈ 8 格） | 圆形高斯衰减 |
| 力度系数 | 5.0 | 速度向量 × 系数写入流场 |
| 最大注入速度 | 10.0（归一化） | 防止过强扰动导致数值不稳 |
| 静止触点（无移动）| 不注入（速度向量接近零不写入）| 避免静止触点污染流场 |

### 3.4 坐标转换规则

```
屏幕像素坐标 (px, py)
    ↓ 除以 canvas.getBoundingClientRect() 的宽高
归一化坐标 [0, 1] × [0, 1]
    ↓ 乘以网格分辨率
网格坐标 [0, gridWidth] × [0, gridHeight]
```

DPR 处理：
- Canvas CSS 尺寸与 JS 尺寸分离
- 触控坐标使用 CSS 像素（不用 DPR 缩放的物理像素）
- 归一化后即消除 DPR 差异

### 3.5 交互体验细节

- **preventDefault**：在 `touchstart` 上调用 `preventDefault()`，防止页面滚动/缩放
- **passive: false**：事件监听器需设为非 passive，才能调用 `preventDefault()`
- **触感反馈**：不触发振动（Haptic Feedback），保持纯视觉体验
- **右键菜单**：`oncontextmenu: return false`，防止长按弹出系统菜单

---

## 4. 加载状态

### 4.1 初始 HTML 状态（JS 未加载前）

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│                                     │
│              (纯黑背景)              │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

- Body 背景色：`#000000`
- 无白屏闪烁（HTML 内联背景色）
- Canvas 元素初始 `display: none`

### 4.2 WebGPU 初始化中（可选加载指示）

最简实现方案（避免过度设计）：

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│                ●                    │  ← 单个圆点，CSS 脉冲动画
│                                     │    颜色：#00c4e8（青蓝）
│                                     │    尺寸：8px × 8px
│                                     │    动画：opacity 0.3→1.0 循环 1.2s
└─────────────────────────────────────┘
```

加载指示 CSS：

```css
.loading-dot {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #00c4e8;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: translate(-50%, -50%) scale(1); }
  50%       { opacity: 1.0; transform: translate(-50%, -50%) scale(1.4); }
}
```

- 初始化成功后：隐藏 loading dot → 显示 Canvas → 启动渲染循环
- 初始化失败后：隐藏 loading dot → 显示不兼容提示页

### 4.3 初始化超时处理

- 超时时间：5000ms（见 PRD F1）
- 超时后：视为不支持 → 进入不兼容提示页

---

## 5. 不兼容提示页规格

### 5.1 布局

```
┌─────────────────────────────────────┐
│  background: #000000                │
│                                     │
│                                     │
│           ≋ (水波图标)              │  ← 32px，颜色 #00c4e8
│                                     │
│    需要支持 WebGPU 的浏览器          │  ← 标题，20px，#ffffff
│                                     │
│  这个 Demo 使用 WebGPU 实时          │
│  模拟流体效果，当前浏览器不支持。    │  ← 说明文字，14px，#7a9bbf
│                                     │
│  ┌──────────────────────────────┐   │
│  │  推荐以下浏览器打开：         │   │  ← 灰色边框卡片
│  │                              │   │
│  │  Chrome / Edge 113+          │   │  ← 14px，#b0c8e0
│  │  Android / 桌面端             │   │
│  │                              │   │
│  │  Safari iOS 17+              │   │
│  │  iPhone 12 及以上            │   │
│  └──────────────────────────────┘   │
│                                     │
│  [ 了解 WebGPU ]                    │  ← 文字链接按钮
│                                     │
└─────────────────────────────────────┘
```

### 5.2 颜色规格

| 元素 | 颜色值 | 说明 |
|------|--------|------|
| 页面背景 | `#000000` | 与主体验一致，不显突兀 |
| 图标色 | `#00c4e8` | 水波感青蓝色 |
| 主标题 | `#ffffff` | 高对比白色 |
| 说明文字 | `#7a9bbf` | 降调蓝灰，不抢眼 |
| 推荐浏览器卡片背景 | `#0a1628` | 深海蓝，呼应流体背景色 |
| 卡片边框 | `#1a3a5c` | 微弱蓝色边框 |
| 浏览器列表文字 | `#b0c8e0` | 浅蓝灰 |
| 按钮文字 | `#00c4e8` | 同图标色 |
| 按钮背景 | `transparent` | 纯文字链接风格 |
| 按钮边框 | `#00c4e8 1px solid` | 细边框矩形 |

### 5.3 字体规格

| 元素 | 字号 | 字重 | 行高 |
|------|------|------|------|
| 图标 | 32px（Unicode 字符 ≋ `U+2248` 或 SVG）| — | — |
| 主标题 | 20px | 500 | 1.4 |
| 说明文字 | 14px | 400 | 1.6 |
| 浏览器列表 | 14px | 400 | 1.8 |
| 按钮文字 | 13px | 400 | — |
| 通用字体栈 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | — | — |

### 5.4 间距规格

| 元素 | 间距 |
|------|------|
| 整体容器内边距 | `24px` 水平，`0` 垂直（垂直居中用 flexbox） |
| 图标距标题 | `16px` |
| 标题距说明 | `12px` |
| 说明距卡片 | `24px` |
| 卡片内边距 | `16px` |
| 卡片距按钮 | `28px` |
| 按钮内边距 | `10px 20px` |
| 按钮圆角 | `6px` |

### 5.5 文案（最终版）

```
图标: ≋（或自定义水波 SVG）

标题: 需要支持 WebGPU 的浏览器

说明: 这个 Demo 使用 WebGPU 实时模拟流体效果，
      当前浏览器暂不支持。

卡片标题: 推荐以下浏览器打开：

浏览器列表:
  Chrome / Edge  113+    Android 或桌面端
  Safari         iOS 17+  iPhone 12 及以上

按钮: 了解 WebGPU →
按钮链接: https://developer.chrome.com/docs/web-platform/webgpu
```

### 5.6 错误信息过滤规则

- 不在页面上显示任何 `Error`、`TypeError`、堆栈信息
- `console.error` 仅在开发模式输出（`import.meta.env.DEV`）
- 生产模式：WebGPU 初始化失败只记录 `console.warn('WebGPU not supported')`

### 5.7 不兼容页完整 HTML 结构

```html
<div id="unsupported" class="unsupported-page">
  <div class="unsupported-content">
    <div class="unsupported-icon">≋</div>
    <h1 class="unsupported-title">需要支持 WebGPU 的浏览器</h1>
    <p class="unsupported-desc">
      这个 Demo 使用 WebGPU 实时模拟流体效果，<br>
      当前浏览器暂不支持。
    </p>
    <div class="browser-card">
      <p class="browser-card-title">推荐以下浏览器打开：</p>
      <ul class="browser-list">
        <li><span class="browser-name">Chrome / Edge 113+</span><span class="browser-platform">Android 或桌面端</span></li>
        <li><span class="browser-name">Safari iOS 17+</span><span class="browser-platform">iPhone 12 及以上</span></li>
      </ul>
    </div>
    <a href="https://developer.chrome.com/docs/web-platform/webgpu"
       target="_blank" rel="noopener" class="webgpu-link">
      了解 WebGPU →
    </a>
  </div>
</div>
```

---

## 6. 性能可视化（调试用 FPS 显示）

### 6.1 仅开发模式启用

```javascript
// 只在 Vite dev 模式下显示
if (import.meta.env.DEV) {
  showFpsCounter();
}
```

生产构建（`vite build`）时自动 tree-shake 移除，不影响用户端。

### 6.2 FPS 显示规格

```
┌─────────────────────────────────────┐
│                          [ 58 fps ] │  ← 右上角
│                                     │
│                                     │
│          (Canvas 渲染区)             │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

| 属性 | 值 |
|------|----|
| 位置 | `position: fixed; top: 12px; right: 12px` |
| 字号 | 12px，monospace |
| 颜色（正常） | `rgba(0, 196, 232, 0.8)`（青蓝半透明）|
| 颜色（低帧率 <30fps）| `rgba(255, 80, 80, 0.9)`（红色警告）|
| 背景 | `rgba(0, 0, 0, 0.5)`（半透明黑）|
| 内边距 | `4px 8px` |
| 圆角 | `4px` |
| z-index | `9999` |
| 更新频率 | 每 500ms 更新一次（取 30 帧平均） |

---

## 7. DOM 结构总览

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0,
                                  viewport-fit=cover, user-scalable=no">
  <title>WebGPU 流体</title>
  <style>
    /* 内联关键 CSS，防止 FOUC */
    html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
  </style>
</head>
<body>

  <!-- 状态 1：加载中（初始可见，JS 初始化后隐藏） -->
  <div id="loading" class="loading-state">
    <div class="loading-dot"></div>
  </div>

  <!-- 状态 2：不兼容提示页（初始隐藏，WebGPU 不可用时显示） -->
  <div id="unsupported" class="unsupported-page" style="display:none">
    <!-- 见 §5.7 -->
  </div>

  <!-- 状态 3：主体验 Canvas（初始隐藏，WebGPU 初始化成功后显示） -->
  <canvas id="webgpu-canvas" style="display:none"></canvas>

  <!-- 开发模式 FPS 显示（JS 动态注入） -->
  <!-- <div id="fps-counter"></div>  ← 由 JS 在 DEV 模式创建 -->

  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

### 7.1 状态切换逻辑

```
页面加载
    ↓
显示 #loading（loading-dot 动画）
    ↓
WebGPU 初始化（异步，最长 5s）
    ↓
    ├── 成功 →  隐藏 #loading
    │           显示 #webgpu-canvas
    │           启动 requestAnimationFrame 渲染循环
    │
    └── 失败 →  隐藏 #loading
                显示 #unsupported
```

---

## 8. 响应式断点

本项目不使用媒体查询做布局变化，布局永远全屏。但以下断点影响渲染质量：

| 断点 | 判断方式 | 网格分辨率 | 说明 |
|------|----------|------------|------|
| 低端/中端手机 | `screen.width <= 768` | 256×256 | 省电模式 |
| 高端手机/平板 | `screen.width > 768 && isMobile` | 512×512 | 高质量 |
| 桌面 | `!isMobile` | 512×512 | 全质量 |

移动端判断：`/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)`

Canvas 内部分辨率（渲染像素）与模拟网格分辨率解耦：Canvas 跟随屏幕 DPR，网格按设备性能固定。

---

## 9. 无障碍（最低要求）

本项目为纯视觉 Demo，无障碍要求极简：

- `<canvas>` 添加 `aria-label="WebGPU 流体模拟，用手指触控产生水波涟漪"`
- `<canvas>` 添加 `role="img"`
- 不兼容提示页文字颜色对比度 ≥ 4.5:1（WCAG AA）
  - 白色标题 `#ffffff` on `#000000`：对比度 21:1 ✓
  - 说明文字 `#7a9bbf` on `#000000`：对比度约 5.2:1 ✓
  - 列表文字 `#b0c8e0` on `#0a1628`：对比度约 6.1:1 ✓

---

## 10. 设计 Token 汇总

```javascript
// design-tokens.js（供 CSS 变量或 JS 常量使用）
const tokens = {
  color: {
    background:       '#000000',  // 页面/Canvas 背景
    surfaceDeep:      '#0a1628',  // 深海蓝（卡片/涟漪底色）
    surfaceMid:       '#1a3a5c',  // 中蓝（边框/分割线）
    fluidBase:        '#1a4a6e',  // 流体中段色
    fluidActive:      '#00c4e8',  // 活跃涟漪/图标/按钮
    fluidHighlight:   '#ffffff',  // 高光白色
    textPrimary:      '#ffffff',  // 主文字
    textSecondary:    '#7a9bbf',  // 次要文字
    textTertiary:     '#b0c8e0',  // 第三级文字
    fpsNormal:        'rgba(0,196,232,0.8)',  // FPS 正常
    fpsBad:           'rgba(255,80,80,0.9)',  // FPS 低帧率
  },
  font: {
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono:  "ui-monospace, 'SF Mono', Consolas, monospace",
    size: {
      icon:    '32px',
      title:   '20px',
      body:    '14px',
      caption: '13px',
      fps:     '12px',
    },
  },
  spacing: {
    pagePadding:  '24px',
    cardPadding:  '16px',
    sectionGap:   '24px',
    elementGap:   '12px',
  },
  border: {
    radius: {
      card:   '8px',
      button: '6px',
      fps:    '4px',
    },
  },
  animation: {
    loadingPulse: '1.2s ease-in-out infinite',
  },
};
```

---

**文档结束**  
下一步：根据本 Spec 实现 `index.html` + CSS 层 + DOM 状态管理逻辑。
