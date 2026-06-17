# Fluid Simulation Algorithm

A technical reference for the Navier-Stokes solver implemented in this project.

## The Incompressible Navier-Stokes Equations

For a viscous incompressible fluid, we solve:

```
∂u/∂t + (u · ∇)u = -∇p + ν∇²u + f     (momentum)
∇ · u = 0                                (incompressibility)
```

Where:
- `u` = velocity field (2D vector at each grid point)
- `p` = pressure field (scalar)
- `ν` = kinematic viscosity
- `f` = external forces (mouse/touch input)

In practice, we use a **simplified inviscid form** (ν ≈ 0) with numerical dissipation handling the viscosity implicitly. This trades physical accuracy for interactive performance.

## Helmholtz-Hodge Decomposition

The core trick that makes incompressible solvers work:

Any vector field `w` can be decomposed as:
```
w = u + ∇p
```
where `u` is divergence-free (∇ · u = 0) and `∇p` is curl-free.

So to enforce incompressibility:
1. Compute divergence: `d = ∇ · w`
2. Solve the Poisson equation: `∇²p = d`
3. Project: `u = w - ∇p`

The result `u` is guaranteed to be divergence-free.

## Per-Frame Pipeline

### Pass 1: Advection (`advect.wgsl`)

**Semi-Lagrangian advection** moves quantities backward along the velocity field:

```
// For each grid cell at position x:
x_prev = x - dt * u(x)           // trace backward
q(x, t+dt) = sample(q, x_prev)   // sample quantity at old position
```

This is **unconditionally stable** regardless of timestep size — the key insight from Jos Stam's 1999 paper. Forward Euler integration would explode at high velocities.

The implementation uses **manual bilinear interpolation** because `rg32float` textures are not filterable in WebGPU (the spec prohibits linear sampling on this format):

```wgsl
fn bilinear_sample(tex: texture_storage_2d<rg32float, read>, uv: vec2f, dims: vec2f) -> vec2f {
    let p = uv * dims - 0.5;
    let p0 = floor(p);
    let f = p - p0;
    let x0 = i32(p0.x); let y0 = i32(p0.y);
    
    let v00 = textureLoad(tex, clamp(vec2i(x0,   y0),   vec2i(0), vec2i(dims) - 1));
    let v10 = textureLoad(tex, clamp(vec2i(x0+1, y0),   vec2i(0), vec2i(dims) - 1));
    let v01 = textureLoad(tex, clamp(vec2i(x0,   y0+1), vec2i(0), vec2i(dims) - 1));
    let v11 = textureLoad(tex, clamp(vec2i(x0+1, y0+1), vec2i(0), vec2i(dims) - 1));
    
    return mix(mix(v00.xy, v10.xy, f.x), mix(v01.xy, v11.xy, f.x), f.y);
}
```

### Pass 2: Vorticity Confinement (`vorticity.wgsl`)

Numerical dissipation from advection artificially damps out small vortices. Vorticity confinement injects energy back into these structures:

```
ω = ∂v/∂x - ∂u/∂y               (curl = scalar vorticity in 2D)
N = ∇|ω| / |∇|ω||               (normalized vorticity gradient)
f_vc = ε (N × ω)                 (confinement force, ε = VORTICITY_STRENGTH)
```

This is what makes the fluid look "swirly" rather than smoothly laminar.

### Pass 3: Force Injection (`splat.wgsl`)

Mouse/touch input injects both velocity and dye color:

```wgsl
let dist = distance(uv, splat_pos);
let gaussian = exp(-dist * dist / (splat_radius * splat_radius));
velocity += splat_velocity * gaussian;
dye += splat_color * gaussian;
```

Gaussian falloff gives a smooth, natural-feeling brush.

### Pass 4: Divergence (`divergence.wgsl`)

Central differences on the velocity field:

```wgsl
let dx = (u_right.x - u_left.x) / (2.0 * dx);
let dy = (u_top.y - u_bottom.y) / (2.0 * dy);
divergence = dx + dy;
```

### Pass 5: Pressure Solve (`pressure.wgsl`)

We need to solve the Poisson equation `∇²p = d` (where `d` is divergence).

**Jacobi iteration** approximates the solution by repeated local averaging:

```wgsl
// Each iteration: one Jacobi relaxation step
p_new(i,j) = (p(i+1,j) + p(i-1,j) + p(i,j+1) + p(i,j-1) - h² * d(i,j)) / 4.0
```

We run 20 iterations per frame. This does not fully converge (would need ~100+ iterations for exact solution) but produces visually good results at interactive framerates.

The pressure texture ping-pongs between two buffers each iteration — reading from one, writing to the other, then swapping.

### Pass 6: Gradient Subtraction (`gradient_subtract.wgsl`)

Projects the velocity field to divergence-free:

```wgsl
let grad_p = vec2f(
    (p_right - p_left) / (2.0 * dx),
    (p_top   - p_bottom) / (2.0 * dy)
);
velocity_out = velocity_in - grad_p;
```

After this pass, `∇ · u ≈ 0` (approximately — Jacobi didn't fully converge).

### Pass 7: Render (`render.wgsl`)

Full-screen triangle, samples the dye texture, outputs to the canvas surface:

```wgsl
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = pos.xy / vec2f(uniforms.width, uniforms.height);
    let color = textureSample(dye_tex, samp, uv);
    return vec4f(color.rgb, 1.0);
}
```

## Stability Analysis

The simulation is stable because:

1. **Semi-Lagrangian advection** — unconditionally stable at any timestep
2. **Pressure projection** — enforces incompressibility, prevents divergence from accumulating
3. **Dissipation coefficients** — `VELOCITY_DISSIPATION: 0.98` acts as a damping factor

The main source of visual instability is the pressure solver not fully converging — visible as slight compression artifacts at high velocities. Increasing `JACOBI_ITERATIONS` reduces this at the cost of performance.

## References

- Jos Stam, [*Stable Fluids*](https://www.dgp.toronto.edu/people/stam/reality/Research/pdf/ns.pdf), SIGGRAPH 1999
- GPU Gems Chapter 38, [*Fast Fluid Dynamics Simulation on the GPU*](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
- Pavel Dobryakov, [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) — WebGL predecessor, influenced shader structure
