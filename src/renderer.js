export class Renderer {
  #fluidSim;
  #touchHandler;
  #rafId = null;
  #lastTime = null;

  // FPS counter state
  #fpsEl = null;
  #fpsAccum = 0;
  #frameCount = 0;
  #isDev = window.location.hostname === 'localhost' ||
           (window.location.port !== '' && window.location.port !== '80' && window.location.port !== '443');

  constructor(fluidSim, touchHandler) {
    this.#fluidSim    = fluidSim;
    this.#touchHandler = touchHandler;
    if (this.#isDev) this.#initFpsCounter();
  }

  #initFpsCounter() {
    this.#fpsEl = document.createElement('div');
    this.#fpsEl.id = 'fps-counter';
    this.#fpsEl.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px',
      'font-size:12px', 'font-family:monospace',
      'background:rgba(0,0,0,0.55)',
      'padding:4px 8px', 'border-radius:4px',
      'z-index:9999', 'color:rgba(0,196,232,0.8)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.#fpsEl);
  }

  #updateFps(rawDt) {
    this.#fpsAccum  += rawDt;
    this.#frameCount++;
    if (this.#fpsAccum >= 0.5) {
      const fps = Math.round(this.#frameCount / this.#fpsAccum);
      if (this.#fpsEl) {
        this.#fpsEl.textContent = `${fps} fps`;
        this.#fpsEl.style.color = fps < 30
          ? 'rgba(255,80,80,0.9)'
          : 'rgba(0,196,232,0.8)';
      }
      this.#fpsAccum  = 0;
      this.#frameCount = 0;
    }
  }

  #loop = (now) => {
    this.#rafId = requestAnimationFrame(this.#loop);

    if (this.#lastTime === null) {
      this.#lastTime = now;
      return;
    }

    const rawDt = (now - this.#lastTime) / 1000.0;
    this.#lastTime = now;

    // Clamp dt: [1/120, 1/30] — prevents NaN/Inf from large steps or tab freeze
    const dt = Math.max(1 / 120, Math.min(rawDt, 1 / 30));

    const splats = this.#touchHandler.getSplats(dt);
    this.#fluidSim.step(dt, splats);

    if (this.#isDev) this.#updateFps(rawDt);
  };

  start() {
    if (this.#rafId !== null) return;
    this.#lastTime = null;
    this.#rafId = requestAnimationFrame(this.#loop);
  }

  stop() {
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    if (this.#fpsEl) {
      this.#fpsEl.remove();
      this.#fpsEl = null;
    }
  }
}
