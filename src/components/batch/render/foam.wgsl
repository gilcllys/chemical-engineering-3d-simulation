// ── Foam / bubble sprite pass ─────────────────────────────────────────────
// Position-based foam: renders white billboards only at the vortex funnel
// and at the surface ring near the reactor wall.
// FoamUniforms layout (40 f32 = 160 bytes):
//   [0..15]  projection_matrix  mat4x4f
//   [16..31] view_matrix        mat4x4f
//   [32]     foam_size          f32  (billboard half-size in world space)
//   [33]     foam_intensity     f32  (0=no foam, 1=max agitation)
//   [34]     surface_y          f32  (y-coord of liquid surface, e.g. -0.10)
//   [35]     reactor_radius     f32  (inner radius of reactor, e.g. 0.87)
//   [36]     vortex_depth       f32  (depth of vortex funnel, e.g. 0 to 0.18)
//   [37]     funnel_thickness   f32  (±band around funnel surface, e.g. 0.08)
//   [38]     ring_width         f32  (outer ring band width, e.g. 0.18)
//   [39]     _pad               f32

struct PosVel {
    position: vec3f,
    _pad0:    f32,
    v:        vec3f,
    _pad1:    f32,
}

struct FoamUniforms {
    projection_matrix: mat4x4f,  //   0–63
    view_matrix:       mat4x4f,  //  64–127
    foam_size:         f32,      // 128
    foam_intensity:    f32,      // 132  (0-1 agitation level)
    surface_y:         f32,      // 136  (liquid surface world Y)
    reactor_radius:    f32,      // 140  (inner reactor radius)
    vortex_depth:      f32,      // 144  (funnel depth in metres)
    funnel_thickness:  f32,      // 148  (band ±m around funnel cone)
    ring_width:        f32,      // 152  (outer wall ring band width)
    _pad:              f32,      // 156
}

@group(0) @binding(0) var<storage, read> particles: array<PosVel>;
@group(0) @binding(1) var<uniform>       uniforms:  FoamUniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0)       uv:       vec2f,
    @location(1)       alpha:    f32,
}

@vertex
fn vs(
    @builtin(vertex_index)   vertex_index:   u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    var corners = array<vec2f, 6>(
        vec2f( 0.5,  0.5),
        vec2f( 0.5, -0.5),
        vec2f(-0.5, -0.5),
        vec2f( 0.5,  0.5),
        vec2f(-0.5, -0.5),
        vec2f(-0.5,  0.5),
    );

    let p         = particles[instance_index];
    let xz_dist   = length(p.position.xz);   // radial distance from axis
    let r_norm    = clamp(xz_dist / uniforms.reactor_radius, 0.0, 1.0);

    // ── Vortex funnel ──────────────────────────────────────────────────────
    // Parabolic cone: y_cone(r) = surface_y - vortex_depth*(1 - r_norm)²
    let y_cone      = uniforms.surface_y - uniforms.vortex_depth * (1.0 - r_norm) * (1.0 - r_norm);
    let dist_cone   = abs(p.position.y - y_cone);
    let funnel_factor = clamp(1.0 - dist_cone / max(uniforms.funnel_thickness, 0.001), 0.0, 1.0);

    // ── Surface ring (outer wall) ──────────────────────────────────────────
    let dr_ring     = uniforms.reactor_radius - xz_dist;   // distance from wall
    let ring_radial = clamp(1.0 - dr_ring / max(uniforms.ring_width, 0.001), 0.0, 1.0);
    let dy_surface  = uniforms.surface_y - p.position.y;   // below surface
    let ring_surf   = clamp(1.0 - dy_surface / 0.12, 0.0, 1.0);
    let ring_factor = ring_surf * ring_radial;

    // ── Combined alpha ─────────────────────────────────────────────────────
    let geo_factor = max(funnel_factor * uniforms.foam_intensity,
                         ring_factor   * uniforms.foam_intensity);
    let alpha = geo_factor * 0.75;

    let corner  = vec3f(corners[vertex_index] * uniforms.foam_size, 0.0);
    let viewPos = (uniforms.view_matrix * vec4f(p.position, 1.0)).xyz;
    let clipPos = uniforms.projection_matrix * vec4f(viewPos + corner, 1.0);

    var out: VertexOutput;
    out.position = clipPos;
    out.uv       = corners[vertex_index] + vec2f(0.5);
    out.alpha    = alpha;
    return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
    let uv = input.uv * 2.0 - vec2f(1.0);
    let r2 = dot(uv, uv);
    if (r2 > 1.0) { discard; }

    let softness = 1.0 - r2;
    let a        = input.alpha * softness * softness;
    if (a < 0.01) { discard; }

    return vec4f(0.95, 0.97, 1.0, a);
}
