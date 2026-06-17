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

    let fluidSim     = new FluidSim();
    let touchHandler = new TouchHandler(canvas);
    let renderer     = new Renderer(fluidSim, touchHandler);

    await fluidSim.init(gpu.device, gpu.context, gpu.canvasFormat, canvas);
    showCanvas();
    renderer.start();

    // 首次触摸时隐藏提示
    const hintEl = document.getElementById('hint-overlay');
    if (hintEl) {
      const hideHint = () => {
        hintEl.style.opacity = '0';
        setTimeout(() => { hintEl.style.display = 'none'; }, 800);
        canvas.removeEventListener('touchstart', hideHint);
        canvas.removeEventListener('mousedown', hideHint);
      };
      canvas.addEventListener('touchstart', hideHint, { once: true });
      canvas.addEventListener('mousedown', hideHint, { once: true });
    }

    // 启动后 800ms 注入初始涟漪（通过 touchHandler 队列，在下一帧自然消费）
    setTimeout(() => {
      if (touchHandler && touchHandler.queueAutoSplats) {
        touchHandler.queueAutoSplats();
      }
    }, 800);

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
      touchHandler.destroy();
      try {
        const gpu2 = await initWebGPU(canvas);
        fluidSim     = new FluidSim();
        touchHandler = new TouchHandler(canvas);
        renderer     = new Renderer(fluidSim, touchHandler);
        await fluidSim.init(gpu2.device, gpu2.context, gpu2.canvasFormat, canvas);
        renderer.start();
      } catch {
        showUnsupportedPage();
      }
    });

  } catch (e) {
    if (window.location.hostname === 'localhost' || window.location.port !== '') {
      console.error(e);
    }
    showUnsupportedPage();
  }
}

main();
