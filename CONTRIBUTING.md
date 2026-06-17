# Contributing to WebGPU Fluid Simulation

## Requirements

- Chrome 113+ / Edge 113+ (WebGPU required)
- Basic understanding of GPU compute pipelines

## Setup

```bash
git clone https://github.com/LIAlia111/webgpu-fluid.git
cd webgpu-fluid
npx serve .
# open http://localhost:3000
```

WebGPU requires HTTP — `file://` won't work.

## Project Structure

```
src/           JavaScript: GPU init, sim core, render loop, input
shaders/       WGSL compute and render shaders
```

## Modifying Shaders

WGSL shaders are in `shaders/`. Each file is a single compute or render pass.

When editing shaders, note:
- **Binding layout must match JS** — `@group(N) @binding(M)` in WGSL must correspond to `GPUBindGroupLayout` entries in `fluid-sim.js`
- **Storage textures vs sampled textures** — `rg32float` is not filterable in WebGPU; manual bilinear interpolation is required in `advect.wgsl`
- **Workgroup size** — shaders use `@workgroup_size(8, 8)`. Grid dimensions are aligned to 16 to satisfy this

## Tuning Parameters

In `src/fluid-sim.js`:

```javascript
const CONFIG = {
  JACOBI_ITERATIONS:    20,    // Higher = more accurate pressure, slower
  VORTICITY_STRENGTH:   0.35,  // Higher = more swirl (can go unstable above 1.0)
  VELOCITY_DISSIPATION: 0.98,  // Lower = velocity fades faster
  DYE_DISSIPATION:      0.97,  // Lower = color fades faster
  SPLAT_RADIUS:         0.03,  // Interaction radius
  SPLAT_FORCE:          5.0,   // Force on mouse/touch
};
```

## Known Limitations

- **Safari**: WebGPU is behind a flag in Safari Technology Preview; not in stable Safari yet
- **Firefox**: WebGPU not yet available
- **Mobile**: Performance scales down to 256×256 grid automatically; very old devices may still drop frames
- **rg32float filtering**: WebGPU spec does not allow linear filtering on `rg32float` textures — this is why `advect.wgsl` implements manual bilinear interpolation

## Reporting Bugs

Include:
- Browser + version
- GPU (from `chrome://gpu` or `about:gpu`)
- Error from browser console
- Steps to reproduce
