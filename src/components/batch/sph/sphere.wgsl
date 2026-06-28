struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) view_position: vec3f,
    @location(2) speed: f32,
    @location(3) world_position: vec3f,
}

struct FragmentInput {
    @location(0) uv: vec2f,
    @location(1) view_position: vec3f,
    @location(2) speed: f32,
    @location(3) world_position: vec3f,
}

struct FragmentOutput {
    @location(0) frag_color: vec4f,
    @builtin(frag_depth) frag_depth: f32,
}

struct RenderUniforms {
    texel_size: vec2f,               // offset   0, size  8
    sphere_size: f32,                // offset   8, size  4
    // 4 bytes implicit padding      // offset  12
    inv_projection_matrix: mat4x4f,  // offset  16, size 64
    projection_matrix: mat4x4f,      // offset  80, size 64
    view_matrix: mat4x4f,            // offset 144, size 64
    inv_view_matrix: mat4x4f,        // offset 208, size 64
    color_mode:  u32,                // offset 272, size  4  (0=velocity, 1=temperature, 2=concentration)
    temperature: f32,                // offset 276, size  4  (jacket degC 25-100)
    mixedness:   f32,                // offset 280, size  4  (0-1 mixing index)
    _pad:        f32,                // offset 284, size  4  (alignment pad -> struct = 288 bytes)
}

struct PosVel {
    position: vec3f,
    v: vec3f,
}

@group(0) @binding(0) var<storage> particles: array<PosVel>;
@group(0) @binding(1) var<uniform> uniforms: RenderUniforms;

@vertex
fn vs(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var corner_positions = array(
        vec2( 0.5,  0.5),
        vec2( 0.5, -0.5),
        vec2(-0.5, -0.5),
        vec2( 0.5,  0.5),
        vec2(-0.5, -0.5),
        vec2(-0.5,  0.5),
    );

    let corner = vec3(corner_positions[vertex_index] * uniforms.sphere_size, 0.0);
    let uv = corner_positions[vertex_index] + 0.5;

    let real_position = particles[instance_index].position;
    let view_position = (uniforms.view_matrix * vec4f(real_position, 1.0)).xyz;

    let out_position = uniforms.projection_matrix * vec4f(view_position + corner, 1.0);

    let speed = sqrt(dot(particles[instance_index].v, particles[instance_index].v));

    return VertexOutput(out_position, uv, view_position, speed, real_position);
}

fn value_to_color(value: f32) -> vec3<f32> {
    let col0 = vec3f(0, 0.4, 0.8);
    let col1 = vec3f(35, 161, 165) / 256;
    let col2 = vec3f(95, 254, 150) / 256;
    let col3 = vec3f(243, 250, 49) / 256;
    let col4 = vec3f(255, 165, 0) / 256;

    if (0 <= value && value < 0.25) {
        let t = value / 0.25;
        return mix(col0, col1, t);
    } else if (0.25 <= value && value < 0.50) {
        let t = (value - 0.25) / 0.25;
        return mix(col1, col2, t);
    } else if (0.50 <= value && value < 0.75) {
        let t = (value - 0.50) / 0.25;
        return mix(col2, col3, t);
    } else {
        let t = (value - 0.75) / 0.25;
        return mix(col3, col4, t);
    }
}

@fragment
fn fs(input: FragmentInput) -> FragmentOutput {
    var out: FragmentOutput;

    var normalxy: vec2f = input.uv * 2.0 - 1.0;
    var r2: f32 = dot(normalxy, normalxy);
    if (r2 > 1.0) {
        discard;
    }
    var normalz = sqrt(1.0 - r2);
    var normal = vec3(normalxy, normalz);

    var radius = uniforms.sphere_size / 2;
    var real_view_pos: vec4f = vec4f(input.view_position + normal * radius, 1.0);
    var clip_space_pos: vec4f = uniforms.projection_matrix * real_view_pos;
    out.frag_depth = clip_space_pos.z / clip_space_pos.w;

    var diffuse: f32 = max(0.0, dot(normal, normalize(vec3(1.0, 1.0, 1.0))));

    var color: vec3f;

    if (uniforms.color_mode == 1u) {
        // ── colorMode 1: temperature ─────────────────────────────────────────
        // Particles near the wall are heated by the jacket; centre is cooler.
        // High mixedness -> uniform temperature throughout.
        let reactor_r   = 0.87;
        let wall_dist   = reactor_r - length(input.world_position.xz);
        let radial_heat = 1.0 - clamp(wall_dist / reactor_r, 0.0, 1.0);
        // Mix radial gradient toward uniform as mixedness increases
        let heat = mix(radial_heat, 0.65, uniforms.mixedness);
        // Normalised temperature scalar
        let t_norm = clamp((uniforms.temperature - 25.0) / 75.0, 0.0, 1.0) * heat;
        // Multi-stop colormap: blue -> cyan -> yellow -> red
        if (t_norm < 0.33) {
            color = mix(vec3f(0.1, 0.3, 0.9), vec3f(0.0, 0.8, 0.8), t_norm / 0.33);
        } else if (t_norm < 0.66) {
            color = mix(vec3f(0.0, 0.8, 0.8), vec3f(1.0, 0.8, 0.0), (t_norm - 0.33) / 0.33);
        } else {
            color = mix(vec3f(1.0, 0.8, 0.0), vec3f(1.0, 0.2, 0.0), (t_norm - 0.66) / 0.34);
        }

    } else if (uniforms.color_mode == 2u) {
        // ── colorMode 2: concentration dye ───────────────────────────────────
        // Initial state: bottom half = reactant A (amber), top half = reactant B (teal).
        // Mixing converges both layers to a purple-blue product.
        let reactor_bot = -1.32;
        let reactor_top = -0.10;  // LIQUID_FILL_Y
        let y_norm = clamp(
            (input.world_position.y - reactor_bot) / (reactor_top - reactor_bot),
            0.0, 1.0
        );
        let colorA     = vec3f(0.9, 0.5, 0.1);   // amber -- reactant A
        let colorB     = vec3f(0.1, 0.7, 0.8);   // teal  -- reactant B
        let colorMixed = vec3f(0.3, 0.5, 0.9);   // blue-purple -- fully mixed
        let segregated = mix(colorA, colorB, y_norm);
        color = mix(segregated, colorMixed, uniforms.mixedness);

    } else {
        // ── colorMode 0 (default): velocity ─────────────────────────────────
        color = value_to_color(input.speed / 1.5);
    }

    out.frag_color = vec4(color * diffuse, 1.);
    return out;
}
