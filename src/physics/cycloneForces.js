/**
 * cycloneForces.js — Pure physics functions for cyclone separator simulation.
 * No React, no Three.js — pure math so it can be unit-tested independently.
 *
 * Reference: Lapple (1951) cyclone model + Rankine vortex + Muschelknautz axial model
 * All SI units unless otherwise noted.
 */

// ─── Physical constants ────────────────────────────────────────────────────────

export const RHO_GAS       = 1.2       // kg/m³  — air at ~20 °C
export const MU_GAS        = 1.81e-5   // Pa·s   — dynamic viscosity of air
export const RHO_PARTICLE  = 1500      // kg/m³  — typical industrial dust
export const G             = 9.81      // m/s²   — gravitational acceleration

// ─── Lapple model ─────────────────────────────────────────────────────────────

/**
 * Number of effective turns (Lapple, 1951).
 * Larger Ne → more residence time → better separation.
 * @param {number} cylinderHeight  - m
 * @param {number} coneHeight      - m
 * @param {number} inletWidth      - m  (height of inlet opening = B)
 */
export function calcNe(cylinderHeight, coneHeight, inletWidth) {
  if (inletWidth <= 0) return 0
  return (cylinderHeight + coneHeight / 2) / inletWidth
}

/**
 * Lapple d₅₀ cut size — particle diameter at 50 % collection efficiency (m).
 * d₅₀ = √( 9 · μ · B / (π · Ne · Vᵢ · Δρ) )
 *
 * @param {number} inletVelocity   - m/s
 * @param {number} cylinderRadius  - m   (R)
 * @param {number} cylinderHeight  - m   (Hc)
 * @param {number} coneHeight      - m   (Hz)
 * @param {number} inletWidth      - m   (B)
 * @returns {number} d₅₀ in metres
 */
export function calcD50(inletVelocity, cylinderRadius, cylinderHeight, coneHeight, inletWidth) {
  const Ne    = calcNe(cylinderHeight, coneHeight, inletWidth)
  const dRho  = RHO_PARTICLE - RHO_GAS
  const denom = Math.PI * Ne * inletVelocity * dRho
  if (denom <= 0) return 0
  const val = (9 * MU_GAS * inletWidth) / denom
  return val > 0 ? Math.sqrt(val) : 0
}

/**
 * Lapple fractional collection efficiency for a single particle diameter dp.
 * η = 1 / (1 + (d₅₀/dp)²)
 *
 * @param {number} dp  - particle diameter (m)
 * @param {number} d50 - cut size (m)
 * @returns {number}  0 … 1
 */
export function calcEfficiency(dp, d50) {
  if (d50 <= 0 || dp <= 0) return 0
  return 1 / (1 + Math.pow(d50 / dp, 2))
}

// ─── Flow-field models ────────────────────────────────────────────────────────

/**
 * Tangential gas velocity at radius r (Rankine vortex, turbulent exponent n = 0.6).
 *
 * Outer vortex  (r ≥ R_core): v_t = V_in · (R_in/r)^n   decreasing
 * Inner vortex  (r < R_core): v_t = V_in · (r/R_core)    solid-body rotation
 *
 * @param {number} r              - radial position (m), clamped > 0
 * @param {number} inletVelocity  - m/s
 * @param {number} cylinderRadius - m
 * @returns {number} tangential speed (m/s), always ≥ 0
 */
export function tangentialVelocity(r, inletVelocity, cylinderRadius) {
  const n      = 0.6
  const R_in   = cylinderRadius * 0.88   // effective inlet radius
  const R_core = cylinderRadius * 0.30   // vortex-core radius
  if (r <= 0.001) return 0
  if (r < R_core) {
    return inletVelocity * (r / R_core)
  }
  return inletVelocity * Math.pow(R_in / r, n)
}

/**
 * Axial gas velocity at radius r.
 * Outer zone (r ≥ R_core): negative (downward) — carries particles to apex.
 * Inner core (r < R_core): positive (upward)  — carries gas to overflow.
 *
 * Simplified Muschelknautz model.
 *
 * @param {number} r              - radial position (m)
 * @param {number} cylinderRadius - m
 * @param {number} inletVelocity  - m/s
 * @param {boolean} isInCone      - whether the particle is in the conical section
 * @param {number} coneProgress   - 0 (cone top) … 1 (apex); used to accelerate downward flow
 * @returns {number} axial speed (m/s); negative = down, positive = up
 */
export function axialVelocity(r, cylinderRadius, inletVelocity, isInCone, coneProgress) {
  const R_core    = cylinderRadius * 0.30
  const Q_total   = inletVelocity * 0.4 * 0.4   // approximate volumetric flow (m³/s)
  const A_outer   = Math.PI * (cylinderRadius ** 2 - R_core ** 2)
  const v_down    = -Q_total / A_outer * 0.8     // downward speed in outer zone

  if (r < R_core) {
    // Inner vortex: upward
    const A_inner = Math.PI * R_core ** 2
    return (Q_total / A_inner) * 1.2
  }
  // Outer zone: downward, faster near cone apex
  return v_down * (1 + (isInCone ? coneProgress * 0.5 : 0))
}

// ─── Particle properties ─────────────────────────────────────────────────────

/**
 * Particle mass from diameter, assuming a sphere of density RHO_PARTICLE.
 * m = ρ · (4/3) · π · (dp/2)³
 * @param {number} dp - diameter (m)
 * @returns {number} mass (kg)
 */
export function particleMass(dp) {
  return RHO_PARTICLE * (4 / 3) * Math.PI * Math.pow(dp / 2, 3)
}

/**
 * Stokes drag coefficient  k = 18 · μ / (ρ_p · dp²)   [s⁻¹]
 *
 * The drag acceleration on the particle is  a_drag = k · (v_gas − v_particle).
 * Large dp → small k → particle barely follows gas → centrifugal wins.
 * Small dp → large k → particle snaps to gas velocity.
 *
 * @param {number} dp - diameter (m)
 * @returns {number} drag coefficient (s⁻¹)
 */
export function stokesDragCoeff(dp) {
  if (dp <= 0) return 0
  return (18 * MU_GAS) / (RHO_PARTICLE * dp * dp)
}

/**
 * Centrifugal acceleration at radius r for a particle in a flow of tangential speed vt.
 * a_c = vt² / r   (radially outward)
 * @param {number} vt - tangential speed of the gas (m/s)
 * @param {number} r  - radial distance (m)
 * @returns {number} acceleration (m/s²)
 */
export function centrifugalAccel(vt, r) {
  if (r < 0.01) return 0
  return (vt * vt) / r
}

// ─── Engineering metrics ──────────────────────────────────────────────────────

/**
 * Stokes number — ratio of particle inertia to fluid drag.
 * St = ρ_p · dp² · Vᵢ / (18 · μ · D)
 * St >> 1 → particle ignores gas; St << 1 → particle follows gas.
 */
export function stokesNumber(dp, inletVelocity, cylinderRadius) {
  return (RHO_PARTICLE * dp * dp * inletVelocity) / (18 * MU_GAS * 2 * cylinderRadius)
}

/**
 * Cyclone pressure drop via the Euler-number model.
 * ΔP = Eu · ½ · ρ_gas · Vᵢ²
 * Typical Eu ≈ 6.4 for a standard tangential inlet cyclone.
 */
export function pressureDrop(inletVelocity, Eu = 6.4) {
  return Eu * 0.5 * RHO_GAS * inletVelocity * inletVelocity
}
