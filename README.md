# WebGPU Fluid Simulation

> Real-time Navier-Stokes fluid simulation running entirely on the GPU — written in WebGPU and WGSL.

![WebGPU](https://img.shields.io/badge/API-WebGPU-orange?style=flat-square)
![WGSL](https://img.shields.io/badge/Shaders-WGSL-purple?style=flat-square)
![60fps](https://img.shields.io/badge/Target-60fps-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

---

## What It Is

A fluid simulator built from scratch on **WebGPU** — the successor to WebGL, giving web apps near-native access to the GPU compute pipeline.

Touch or click anywhere. Watch the fluid react.

Every frame runs a full Navier-Stokes solver on the GPU:
velocity advection → vorticity confinement → divergence computation → pressure solve (Jacobi iteration) → gradient subtraction → dye advection → render.

No Three.js. No physics engine. Just raw GPU compute passes and hand-written WGSL shaders.

---

## How It Works

### The Physics Pipeline (per frame)

```
Input: mouse/touch splats (velocity + dye injection)
  │
  ▼
① Advect velocity        — semi-Lagrangian self-advection of the velocity field
  │
  ▼
② Vorticity confinement  — amplify rotational structures to prevent artificial damping
  │
  ▼
③ Divergence             — compute ∇·u (how much fluid is expanding/compressing)
  │
  ▼
④ Pressure solve         — iterative Jacobi relaxation (20 iterations) to find pressure field
  │
  ▼
⑤ Gradient subtraction   — u = u - ∇p  →  enforce incompressibility (∇·u = 0)
  │
  ▼
⑥ Advect dye             — carry color through the corrected velocity field
  │
  ▼
⑦ Render                 — sample dye texture, tone-map to screen
```

### Shader Files

| Shader | Stage | What It Does |
|--------|-------|--------------|
| `advect.wgsl` | Compute | Semi-Lagrangian advection for both velocity and dye — manual bilinear interpolation (required because `rg32float` textures aren't filterable) |
| `vorticity.wgsl` | Compute | Curl computation + vorticity confinement force injection |
| `divergence.wgsl` | Compute | Central-difference divergence of velocity field |
| `pressure.wgsl` | Compute | Jacobi iteration step for pressure Poisson equation |
| `gradient_subtract.wgsl` | Compute | Project velocity field to divergence-free via pressure gradient |
| `splat.wgsl` | Compute | Inject velocity + dye at touch/mouse contact points |
| `render.wgsl` | Render | Full-screen quad, samples dye texture, outputs to screen |

### Double Buffering

Every texture field (velocity, pressure, dye) uses a **ping-pong double buffer** — each pass reads from one texture and writes to the other, then swaps. This avoids read-write hazards on the GPU without needing explicit synchronization barriers.

```javascript
class DoubleBuffer {
  get read()  { return this.readIdx === 0 ? this.ping : this.pong; }
  get write() { return this.readIdx === 0 ? this.pong : this.ping; }
  swap()      { this.readIdx ^= 1; }
}
```

### Adaptive Resolution

Grid resolution scales with viewport size and device pixel ratio:
- Desktop: up to 512×512 simulation grid
- Mobile: capped at 256×256 for consistent 60fps on lower-end GPUs
- Grid dimensions are always aligned to 16 (WebGPU `workgroupSize` alignment requirement)

### Simulation Parameters

```javascript
const CONFIG = {
  JACOBI_ITERATIONS:    20,    // Pressure solve accuracy vs. cost
  VORTICITY_STRENGTH:   0.35,  // How aggressively swirling is amplified
  VELOCITY_DISSIPATION: 0.98,  // Velocity decay per frame
  DYE_DISSIPATION:      0.97,  // Color fade rate
  SPLAT_RADIUS:         0.03,  // Interaction radius (normalized)
  SPLAT_FORCE:          5.0,   // Force magnitude on touch
};
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| GPU API | **WebGPU** | First-class compute pipelines, explicit resource management, no legacy baggage |
| Shader language | **WGSL** | Statically typed, no GLSL quirks, native to WebGPU |
| JS | Vanilla ES6 modules | Zero runtime overhead — GPU is the bottleneck, not JS |
| Build | None | Static files + ES modules |

---

## Getting Started

**Requires:** Chrome 113+ / Edge 113+ / Chrome Canary (WebGPU enabled by default)

```bash
git clone https://github.com/LIAlia111/webgpu-fluid.git
cd webgpu-fluid

# Must serve via HTTP (ES modules require a server)
npx serve .
# → open http://localhost:3000
```

> **Note:** WebGPU does not work from `file://` — you need a local HTTP server.

### Check WebGPU Support

```javascript
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) {
  // Browser doesn't support WebGPU — show fallback page
}
```

The app gracefully falls back to a "browser not supported" page if WebGPU is unavailable.

---

## Project Structure

```
webgpu-fluid/
├── index.html              — App shell, canvas, loading state, fallback page
├── style.css               — Minimal styles (fullscreen canvas)
├── src/
│   ├── main.js             — Entry point, initializes GPU + sim + render loop
│   ├── webgpu-init.js      — Device/adapter/context setup
│   ├── fluid-sim.js        — Simulation core: pipeline construction, texture management, per-frame scheduling
│   ├── renderer.js         — RAF loop, dt clamping, FPS counter (dev mode)
│   └── touch-handler.js    — Mouse/touch/pointer input → splat commands
└── shaders/
    ├── advect.wgsl          — Semi-Lagrangian advection (velocity + dye)
    ├── vorticity.wgsl       — Curl + vorticity confinement
    ├── divergence.wgsl      — ∇·u computation
    ├── pressure.wgsl        — Jacobi pressure solver
    ├── gradient_subtract.wgsl — Pressure projection
    ├── splat.wgsl           — Input injection
    └── render.wgsl          — Screen output
```

---

## Performance Notes

- The render loop clamps `dt` to `[1/120, 1/30]` seconds to prevent numerical explosion from tab focus loss or large frame gaps
- Jacobi iterations drop from 20 → 10 automatically when FPS falls below 25 (adaptive quality)
- `GPUDevice.pushErrorScope / popErrorScope` wraps critical passes in dev mode for shader debugging

---

## Why WebGPU

WebGL compute is a hack — you encode compute as fragment shaders writing to textures. WebGPU exposes actual compute pipelines with structured storage buffers, workgroup shared memory, and atomic operations.

For a fluid sim, this means:
- Compute shaders write directly to storage textures — no render-target workarounds
- `@workgroup_size(8, 8)` fills a 64-thread workgroup naturally — GPUs love this
- WGSL's explicit binding layout (`@group(N) @binding(M)`) makes multi-pass data flow readable

---

## About

Built by **[Lief (廖文东)](https://lief.liaolief.com)** — AI Agent Engineer with a graphics background.

This project started as a deep dive into WebGPU before spending all his time on AI systems. The physics implementation follows Jos Stam's *Stable Fluids* paper, adapted for a GPU-parallel compute model.

- Portfolio: [lief.liaolief.com](https://lief.liaolief.com)
- GitHub: [@LIAlia111](https://github.com/LIAlia111)

---

## License

MIT — fork it, learn from it, build something cool.
