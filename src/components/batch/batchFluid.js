/**
 * batchFluid.js
 * ─────────────
 * Standalone MLS-MPM (Material Point Method) fluid simulation module
 * for the batch reactor cylindrical vessel.
 *
 * No React imports — pure JS math.
 *
 * Exports:
 *   createFluidState(N)                               → initial state
 *   stepFluid(state, dt, agitatorSpeed, agitatorAngle) → mutates state in-place
 */

// ── Domain constants (world-space, matching BatchReactor3D geometry) ──────────
const VESSEL_R     = 0.88     // cylinder interior radius
const Y_FLOOR      = -1.40    // bottom of liquid (inside dome bottom)
const Y_TOP        =  1.10    // top of liquid (below agitator shaft upper)
const SPHERE_R     =  0.055   // particle visual + physics radius

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID  = 28              // 28³ grid cells
const GRID2 = GRID * GRID     // cells per layer (pre-computed)

// ── Physics constants ─────────────────────────────────────────────────────────
const STIFFNESS    = 15.0
const REST_DENSITY =  4.0     // slightly higher → denser packing (liquid-like)
const VISCOSITY    =  0.12
const GRAVITY      = -6.0 / GRID   // in grid-space
const PARTICLE_MASS =  1.0

// ─────────────────────────────────────────────────────────────────────────────
/**
 * createFluidState — initialise N particles randomly inside the cylinder.
 *
 * @param  {number} N  number of particles (default 500)
 * @returns {{ particles: Array<object>, grid: Float32Array }}
 */
export function createFluidState(N = 500) {
  const particles = new Array(N)
  const maxR  = VESSEL_R - SPHERE_R
  const maxR2 = maxR * maxR
  const yMin  = Y_FLOOR + SPHERE_R
  const ySpan = (Y_TOP - SPHERE_R) - yMin

  for (let i = 0; i < N; i++) {
    // Rejection-sample (x,z) inside cylinder
    let x, z
    do {
      x = (Math.random() * 2 - 1) * maxR
      z = (Math.random() * 2 - 1) * maxR
    } while (x * x + z * z >= maxR2)

    const y = yMin + Math.random() * ySpan

    particles[i] = {
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      C: [0, 0, 0, 0, 0, 0, 0, 0, 0],   // APIC 3×3 affine matrix
      mass: PARTICLE_MASS,
      noise: (Math.random() - 0.5) * 0.3, // per-particle colour noise
    }
  }

  return {
    particles,
    // layout per cell: [vx, vy, vz, mass]
    grid: new Float32Array(GRID * GRID * GRID * 4),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * stepFluid — one MLS-MPM step.
 *
 * Runs 5 passes:
 *   1. Clear grid
 *   2. P2G-1  – scatter momentum
 *   3. P2G-2  – scatter stress (pressure + viscosity)
 *   4. Grid update (normalise, gravity, agitator force, boundary)
 *   5. G2P    – gather velocity back, integrate positions
 * Then applies cylindrical boundary clamp.
 *
 * Velocity convention: vx/vy/vz stored in grid-space (≈ 28× world-normalised).
 *
 * @param {{ particles: Array<object>, grid: Float32Array }} state  – mutated in-place
 * @param {number} dt              frame delta (seconds)
 * @param {number} agitatorSpeed   rad/s
 * @param {number} agitatorAngle   current rotation.y (unused, reserved)
 */
export function stepFluid(state, dt, agitatorSpeed, agitatorAngle) {
  const { particles, grid } = state
  const N = particles.length
  if (N === 0) return

  const simDt = Math.min(dt, 1 / 50)

  const BOX_W = 2 * VESSEL_R          // world-space width  (x and z)
  const BOX_H = Y_TOP - Y_FLOOR       // world-space height (y)

  // ── PASS 1: Clear grid ────────────────────────────────────────────────────
  grid.fill(0)

  // Pre-compute per-particle B-spline data (reused in passes 2, 3, 5)
  const pdata = new Array(N)
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const gx = (p.x + VESSEL_R) / BOX_W * GRID
    const gy = (p.y - Y_FLOOR)  / BOX_H * GRID
    const gz = (p.z + VESSEL_R) / BOX_W * GRID

    const fx = Math.floor(gx), fy = Math.floor(gy), fz = Math.floor(gz)
    const dx = gx - fx - 0.5
    const dy = gy - fy - 0.5
    const dz = gz - fz - 0.5

    pdata[pi] = {
      gx, gy, gz,
      cx0: fx - 1, cy0: fy - 1, cz0: fz - 1,
      wx: [0.5 * (0.5 - dx) ** 2,  0.75 - dx * dx,  0.5 * (0.5 + dx) ** 2],
      wy: [0.5 * (0.5 - dy) ** 2,  0.75 - dy * dy,  0.5 * (0.5 + dy) ** 2],
      wz: [0.5 * (0.5 - dz) ** 2,  0.75 - dz * dz,  0.5 * (0.5 + dz) ** 2],
    }
  }

  // ── PASS 2: P2G-1 — scatter momentum (velocity × mass) to grid ───────────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]
    const C  = p.C
    const vx = p.vx, vy = p.vy, vz = p.vz

    for (let nx = 0; nx < 3; nx++) {
      for (let ny = 0; ny < 3; ny++) {
        for (let nz = 0; nz < 3; nz++) {
          const gcx = cx0 + nx, gcy = cy0 + ny, gcz = cz0 + nz
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue

          const w   = wx[nx] * wy[ny] * wz[nz]
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz

          // APIC affine correction: Q = C · cellDist
          const qx = C[0]*cdx + C[1]*cdy + C[2]*cdz
          const qy = C[3]*cdx + C[4]*cdy + C[5]*cdz
          const qz = C[6]*cdx + C[7]*cdy + C[8]*cdz

          const ptr = (gcx * GRID2 + gcy * GRID + gcz) * 4
          grid[ptr]     += w * (vx + qx)   // momentum x
          grid[ptr + 1] += w * (vy + qy)   // momentum y
          grid[ptr + 2] += w * (vz + qz)   // momentum z
          grid[ptr + 3] += w               // mass (particle weight)
        }
      }
    }
  }

  // ── PASS 3: P2G-2 — scatter stress (pressure + viscosity) ────────────────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]
    const C  = p.C

    // Gather local density from the 27 neighbour cells
    let density = 0
    for (let nx = 0; nx < 3; nx++) {
      for (let ny = 0; ny < 3; ny++) {
        for (let nz = 0; nz < 3; nz++) {
          const gcx = cx0+nx, gcy = cy0+ny, gcz = cz0+nz
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue
          const w  = wx[nx] * wy[ny] * wz[nz]
          density += grid[(gcx*GRID2 + gcy*GRID + gcz)*4 + 3] * w
        }
      }
    }

    // Equation-of-state pressure: EOS = STIFFNESS * max(density/REST - 1, 0)²
    const excess   = density / REST_DENSITY - 1
    const pressure = Math.max(0, excess * excess * STIFFNESS)
    const volume   = density > 0 ? 1.0 / density : 0

    // Stress tensor S = −P·I + ν·(C + Cᵀ)
    const S0 = -pressure + VISCOSITY * (C[0] + C[0])
    const S1 =             VISCOSITY * (C[1] + C[3])
    const S2 =             VISCOSITY * (C[2] + C[6])
    const S3 =             VISCOSITY * (C[3] + C[1])
    const S4 = -pressure + VISCOSITY * (C[4] + C[4])
    const S5 =             VISCOSITY * (C[5] + C[7])
    const S6 =             VISCOSITY * (C[6] + C[2])
    const S7 =             VISCOSITY * (C[7] + C[5])
    const S8 = -pressure + VISCOSITY * (C[8] + C[8])

    const term = volume * (-4.0) * simDt   // eq-16 prefactor

    for (let nx = 0; nx < 3; nx++) {
      for (let ny = 0; ny < 3; ny++) {
        for (let nz = 0; nz < 3; nz++) {
          const gcx = cx0+nx, gcy = cy0+ny, gcz = cz0+nz
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue
          const w   = wx[nx] * wy[ny] * wz[nz]
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz
          const wt  = w * term
          const ptr = (gcx*GRID2 + gcy*GRID + gcz) * 4
          grid[ptr]     += (S0*cdx + S1*cdy + S2*cdz) * wt
          grid[ptr + 1] += (S3*cdx + S4*cdy + S5*cdz) * wt
          grid[ptr + 2] += (S6*cdx + S7*cdy + S8*cdz) * wt
        }
      }
    }
  }

  // ── PASS 4: Grid update — normalise → velocity, gravity, agitator, walls ──
  for (let ci = 0; ci < GRID; ci++) {
    for (let cj = 0; cj < GRID; cj++) {
      for (let ck = 0; ck < GRID; ck++) {
        const ptr  = (ci * GRID2 + cj * GRID + ck) * 4
        const mass = grid[ptr + 3]
        if (mass <= 0) continue

        // Normalise momentum → velocity
        grid[ptr]     /= mass
        grid[ptr + 1] /= mass
        grid[ptr + 2] /= mass

        // Gravity (in grid-space)
        grid[ptr + 1] += GRAVITY * simDt

        // Agitator tangential force applied to every occupied cell
        // World-space position of cell centre
        const wx_w = ci / GRID * BOX_W - VESSEL_R + VESSEL_R / GRID
        const wz_w = ck / GRID * BOX_W - VESSEL_R + VESSEL_R / GRID
        const r_cell = Math.sqrt(wx_w * wx_w + wz_w * wz_w)
        if (r_cell > 1e-8 && r_cell < VESSEL_R) {
          // Tangential direction (counter-clockwise when agitatorSpeed > 0)
          const tx = -wz_w / r_cell
          const tz =  wx_w / r_cell
          const strength = agitatorSpeed * 0.18 * r_cell
          grid[ptr]     += tx * strength
          grid[ptr + 2] += tz * strength
        }

        // Hard-wall boundary: zero normal velocity at grid faces
        if (ci < 1 || ci > GRID - 2) grid[ptr]     = 0
        if (cj < 1 || cj > GRID - 2) grid[ptr + 1] = 0
        if (ck < 1 || ck > GRID - 2) grid[ptr + 2] = 0
      }
    }
  }

  // ── PASS 5: G2P — gather velocity from grid back to particles ────────────
  for (let pi = 0; pi < N; pi++) {
    const p  = particles[pi]
    const { gx, gy, gz, cx0, cy0, cz0, wx, wy, wz } = pdata[pi]

    let newVx = 0, newVy = 0, newVz = 0
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0, b7=0, b8=0

    for (let nx = 0; nx < 3; nx++) {
      for (let ny = 0; ny < 3; ny++) {
        for (let nz = 0; nz < 3; nz++) {
          const gcx = cx0+nx, gcy = cy0+ny, gcz = cz0+nz
          if (gcx < 0 || gcx >= GRID || gcy < 0 || gcy >= GRID || gcz < 0 || gcz >= GRID) continue

          const w   = wx[nx] * wy[ny] * wz[nz]
          const ptr = (gcx*GRID2 + gcy*GRID + gcz) * 4
          const gvx = grid[ptr]
          const gvy = grid[ptr + 1]
          const gvz = grid[ptr + 2]

          newVx += w * gvx
          newVy += w * gvy
          newVz += w * gvz

          // APIC: accumulate outer product B += w · gv ⊗ cellDist
          const cdx = gcx + 0.5 - gx
          const cdy = gcy + 0.5 - gy
          const cdz = gcz + 0.5 - gz
          b0 += w*gvx*cdx;  b1 += w*gvx*cdy;  b2 += w*gvx*cdz
          b3 += w*gvy*cdx;  b4 += w*gvy*cdy;  b5 += w*gvy*cdz
          b6 += w*gvz*cdx;  b7 += w*gvz*cdy;  b8 += w*gvz*cdz
        }
      }
    }

    // Update APIC affine matrix C = 4 · B  (×4 for quadratic B-spline)
    const C = p.C
    C[0]=b0*4; C[1]=b1*4; C[2]=b2*4
    C[3]=b3*4; C[4]=b4*4; C[5]=b5*4
    C[6]=b6*4; C[7]=b7*4; C[8]=b8*4

    p.vx = newVx
    p.vy = newVy
    p.vz = newVz

    // Integrate world-space positions from grid-space velocities
    p.x += p.vx / GRID * 2 * VESSEL_R
    p.y += p.vy / GRID * (Y_TOP - Y_FLOOR)
    p.z += p.vz / GRID * 2 * VESSEL_R
  }

  // ── Cylindrical boundary clamp ────────────────────────────────────────────
  const maxR = VESSEL_R - SPHERE_R

  for (const p of particles) {
    const r2 = p.x*p.x + p.z*p.z

    // Cylinder wall
    if (r2 > maxR * maxR && r2 > 1e-8) {
      const r     = Math.sqrt(r2)
      const scale = maxR / r
      p.x *= scale
      p.z *= scale
      // Reflect radial velocity component (low restitution)
      const nx   = p.x / maxR
      const nz   = p.z / maxR
      const vrad = p.vx*nx + p.vz*nz
      if (vrad > 0) {
        p.vx -= vrad * nx * 1.9
        p.vz -= vrad * nz * 1.9
      }
    }

    // Floor
    if (p.y < Y_FLOOR + SPHERE_R) {
      p.y = Y_FLOOR + SPHERE_R
      if (p.vy < 0) p.vy = -p.vy * 0.05
    }

    // Ceiling
    if (p.y > Y_TOP - SPHERE_R) {
      p.y = Y_TOP - SPHERE_R
      if (p.vy > 0) p.vy = -p.vy * 0.05
    }
  }
}
