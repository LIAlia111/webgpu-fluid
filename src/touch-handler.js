const SPLAT_FORCE = 5.0;

const SPLAT_COLORS = [
  [0.0, 0.78, 0.91],  // 青蓝
  [0.0, 0.91, 0.63],  // 青绿
  [0.7, 0.9,  1.0 ],  // 浅蓝白
  [0.4, 0.6,  1.0 ],  // 蓝紫
  [0.0, 0.6,  0.85],  // 深青
];

export class TouchHandler {
  #canvas;
  #touches = new Map();    // id → { prevU, prevV, currU, currV, colorIdx }
  #pendingSplats = [];
  #mouseDown = false;
  #mousePrev = null;

  // Bound event handlers (for removeEventListener)
  #onTouchStart;
  #onTouchMove;
  #onTouchEnd;
  #onMouseDown;
  #onMouseMove;
  #onMouseUp;
  #onContextMenu;

  constructor(canvas) {
    this.#canvas = canvas;

    this.#onTouchStart  = this.#handleTouchStart.bind(this);
    this.#onTouchMove   = this.#handleTouchMove.bind(this);
    this.#onTouchEnd    = this.#handleTouchEnd.bind(this);
    this.#onMouseDown   = this.#handleMouseDown.bind(this);
    this.#onMouseMove   = this.#handleMouseMove.bind(this);
    this.#onMouseUp     = this.#handleMouseUp.bind(this);
    this.#onContextMenu = (e) => e.preventDefault();

    const opts = { passive: false };
    canvas.addEventListener('touchstart',  this.#onTouchStart,  opts);
    canvas.addEventListener('touchmove',   this.#onTouchMove,   opts);
    canvas.addEventListener('touchend',    this.#onTouchEnd,    opts);
    canvas.addEventListener('touchcancel', this.#onTouchEnd,    opts);
    canvas.addEventListener('mousedown',   this.#onMouseDown);
    canvas.addEventListener('mousemove',   this.#onMouseMove);
    canvas.addEventListener('mouseup',     this.#onMouseUp);
    canvas.addEventListener('mouseleave',  this.#onMouseUp);
    canvas.addEventListener('contextmenu', this.#onContextMenu);
  }

  #toUV(clientX, clientY) {
    const rect = this.#canvas.getBoundingClientRect();
    return {
      u: (clientX - rect.left) / rect.width,
      v: (clientY - rect.top)  / rect.height,
    };
  }

  #handleTouchStart(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const { u, v } = this.#toUV(touch.clientX, touch.clientY);
      this.#touches.set(touch.identifier, {
        prevU: u, prevV: v,
        currU: u, currV: v,
        colorIdx: touch.identifier % SPLAT_COLORS.length,
      });
    }
  }

  #handleTouchMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const pt = this.#touches.get(touch.identifier);
      if (!pt) continue;
      const { u, v } = this.#toUV(touch.clientX, touch.clientY);
      this.#pendingSplats.push({
        prevU: pt.currU, prevV: pt.currV,
        currU: u, currV: v,
        colorIdx: pt.colorIdx,
      });
      pt.prevU = pt.currU; pt.prevV = pt.currV;
      pt.currU = u; pt.currV = v;
    }
  }

  #handleTouchEnd(e) {
    for (const touch of e.changedTouches) {
      this.#touches.delete(touch.identifier);
    }
  }

  #handleMouseDown(e) {
    const { u, v } = this.#toUV(e.clientX, e.clientY);
    this.#mouseDown = true;
    this.#mousePrev = { u, v };
  }

  #handleMouseMove(e) {
    if (!this.#mouseDown || !this.#mousePrev) return;
    const { u, v } = this.#toUV(e.clientX, e.clientY);
    this.#pendingSplats.push({
      prevU: this.#mousePrev.u, prevV: this.#mousePrev.v,
      currU: u, currV: v,
      colorIdx: 0,
    });
    this.#mousePrev = { u, v };
  }

  #handleMouseUp() {
    this.#mouseDown = false;
    this.#mousePrev = null;
  }

  queueAutoSplats() {
    const colors = [[0.0, 0.78, 0.91], [0.0, 0.91, 0.63], [0.7, 0.9, 1.0]];
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const cx = 0.5 + Math.cos(angle) * 0.12;
      const cy = 0.5 + Math.sin(angle) * 0.08;
      this.#pendingSplats.push({
        prevU: cx - Math.cos(angle) * 0.02,
        prevV: cy - Math.sin(angle) * 0.02,
        currU: cx,
        currV: cy,
        colorIdx: i,
      });
    }
  }

  getSplats(dt) {
    const result = [];
    for (const pending of this.#pendingSplats) {
      const dx = (pending.currU - pending.prevU) * SPLAT_FORCE / dt;
      const dy = (pending.currV - pending.prevV) * SPLAT_FORCE / dt;
      if (Math.abs(dx) + Math.abs(dy) < 1e-4) continue;
      result.push({
        u: pending.currU,
        v: pending.currV,
        dx,
        dy,
        color: SPLAT_COLORS[pending.colorIdx],
        radius: 0.03,
      });
    }
    this.#pendingSplats = [];
    return result;
  }

  destroy() {
    const canvas = this.#canvas;
    const opts = { passive: false };
    canvas.removeEventListener('touchstart',  this.#onTouchStart,  opts);
    canvas.removeEventListener('touchmove',   this.#onTouchMove,   opts);
    canvas.removeEventListener('touchend',    this.#onTouchEnd,    opts);
    canvas.removeEventListener('touchcancel', this.#onTouchEnd,    opts);
    canvas.removeEventListener('mousedown',   this.#onMouseDown);
    canvas.removeEventListener('mousemove',   this.#onMouseMove);
    canvas.removeEventListener('mouseup',     this.#onMouseUp);
    canvas.removeEventListener('mouseleave',  this.#onMouseUp);
    canvas.removeEventListener('contextmenu', this.#onContextMenu);
  }
}
