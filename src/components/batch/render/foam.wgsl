// ── Foam / bubble sprite pass ─────────────────────────────────────────────
// Renders screen-aligned soft-white billboards for every particle whose
// speed exceeds foam_threshold. Alpha scales linearly with excess speed so
// the foam grows with agitation and vanishes when the reactor is at rest.

struct PosVel {
    position: vec3f,
    _pad0:    f32,        // matches the 32-byte SPH stride (vec3f + f32 + vec3f + f32)
    v:        vec3f,
    _pad1:    f32,
}

struct FoamUniforms {
    projection_matrix: mat4x4f,  //  0–63 bytes
    view_matrix:       mat4x4f,  // 64–127 bytes
    foam_size:         f32,      // 128
    foam_threshold:    f32,      // 132
    foam_max_speed:    f32,      // 136
    _pad:              f32,      // 140
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
    // Six corners for two triangles that form a quad billboard
    var corners = array<vec2f, 6>(
        vec2f( 0.5,  0.5),
        vec2f( 0.5, -0.5),
        vec2f(-0.5, -0.5),
        vec2f( 0.5,  0.5),
        vec2f(-0.5, -0.5),
        vec2f(-0.5,  0.5),
    );

    let p     = particles[instance_index];
    let speed = length(p.v);

    // Alpha = 0 when at or below threshold; ramps to 0.6 at foam_max_speed
    var alpha = 0.0;
    if (speed > uniforms.foam_threshold) {
        let t = clamp(
            (speed - uniforms.foam_threshold) /
            (uniforms.foam_max_speed - uniforms.foam_threshold),
            0.0, 1.0,
        );
        alpha = t * 0.6;
    }

    // Build a screen-aligned billboard: add the corner offset in VIEW space
    // so the quad always faces the camera regardless of particle orientation.
    let corner  = vec3f(corners[vertex_index] * uniforms.foam_size, 0.0);
    let viewPos = (uniforms.view_matrix * vec4f(p.position, 1.0)).xyz;
    let clipPos = uniforms.projection_matrix * vec4f(viewPos + corner, 1.0);

    var out: VertexOutput;
    out.position = clipPos;
    out.uv       = corners[vertex_index] + vec2f(0.5);   // remap to [0,1]
    out.alpha    = alpha;
    return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
    // Remap UVs from [0,1] to [-1,1] and use the squared radius to make a
    // soft circular sprite; hard-clip anything outside the unit circle.
    let uv = input.uv * 2.0 - vec2f(1.0);
    let r2 = dot(uv, uv);
    if (r2 > 1.0) { discard; }

    // Quadratic falloff from centre → soft, pillow-like bubble appearance
    let softness = 1.0 - r2;
    let a        = input.alpha * softness * softness;

    if (a < 0.01) { discard; }

    // Bright white with a faint cold-blue tint — resembles aerated liquid
    return vec4f(0.95, 0.97, 1.0, a);
}
