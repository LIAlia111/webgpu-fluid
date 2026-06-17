# Task 001: 项目骨架 + 入口 HTML

## 依赖
无（首个任务）

## 产物
- /root/lief-projects/webgpu-fluid/index.html
- /root/lief-projects/webgpu-fluid/style.css
- /root/lief-projects/webgpu-fluid/src/main.js

## 目录结构
mkdir -p /root/lief-projects/webgpu-fluid/src
mkdir -p /root/lief-projects/webgpu-fluid/shaders

## DOM 元素 ID（与集成测试合同一致）
- canvas#gpu-canvas
- #loading-indicator
- #unsupported-page

## index.html 要求

### viewport meta
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">

### 内联关键 CSS（防止 FOUC）
```html
<style>
  html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
</style>
```

### DOM 骨架
- #loading-indicator：初始可见，含 .loading-dot
- #unsupported-page：初始 display:none（Phase 6 完善内容）
- canvas#gpu-canvas：初始 display:none
- <script type="module" src="/webgpu-fluid/src/main.js"></script>

## style.css 要求

### Canvas 全屏
- canvas：position:fixed, top:0, left:0, width:100vw, height:100vh
- html/body：overflow:hidden, background:#000

### Loading dot 动画
- #loading-indicator：position:fixed, 全屏, display:flex, align-items:center, justify-content:center
- .loading-dot：8px, border-radius:50%, background:#00c4e8, animation:pulse 1.2s infinite
- @keyframes pulse：opacity 0.3 → 1.0, scale 1 → 1.4

## src/main.js 要求

### 职责
协调初始化流程，连接所有模块，管理 DOM 状态切换。

### 关键代码

```javascript
import { initWebGPU } from './webgpu-init.js';
import { FluidSim } from './fluid-sim.js';
import { TouchHandler } from './touch-handler.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('gpu-canvas');
const loading = document.getElementById('loading-indicator');
const unsupported = document.getElementById('unsupported-page');

function showUnsupportedPage() {
  loading.style.display = 'none';
  unsupported.style.display = '';
  canvas.style.display = 'none';
}

function showCanvas() {
  loading.style.display = 'none';
  canvas.style.display = 'block';
}

async function main() {
  try {
    const gpu = await initWebGPU(canvas);
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width  = Math.round(window.innerWidth  * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);

    const fluidSim    = new FluidSim();
    const touchHandler = new TouchHandler(canvas);
    const renderer    = new Renderer(fluidSim, touchHandler);

    await fluidSim.init(gpu.device, gpu.context, gpu.canvasFormat, canvas);
    showCanvas();
    renderer.start();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const dpr2 = Math.min(devicePixelRatio, 2);
        canvas.width  = Math.round(window.innerWidth  * dpr2);
        canvas.height = Math.round(window.innerHeight * dpr2);
        fluidSim.handleResize(canvas);
      }, 200);
    });

    gpu.device.lost.then(async () => {
      renderer.stop();
      fluidSim.destroy();
      try {
        const gpu2 = await initWebGPU(canvas);
        await fluidSim.init(gpu2.device, gpu2.context, gpu2.canvasFormat, canvas);
        renderer.start();
      } catch {
        showUnsupportedPage();
      }
    });

  } catch (e) {
    if (window.location.hostname === 'localhost' || window.location.port) {
      console.error(e);
    }
    showUnsupportedPage();
  }
}

main();
```

## 注意事项
- 路径前缀 /webgpu-fluid/ 用于所有资源引用
- ES Module：<script type="module"> 无需 bundler
- DOM ID 必须与集成测试完全匹配
