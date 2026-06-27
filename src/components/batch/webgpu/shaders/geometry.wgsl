struct Uniforms {
    projection: mat4x4f,
    view: mat4x4f,
    model: mat4x4f,
    color: vec4f,
    cameraPos: vec3f,
    isGlass: u32,
}

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4f,
    @location(0) world_pos: vec3f,
    @location(1) world_normal: vec3f,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex
fn vs(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let worldPos = uni.model * vec4f(in.position, 1.0);
    out.clip_pos = uni.projection * uni.view * worldPos;
    out.world_pos = worldPos.xyz;
    out.world_normal = normalize((uni.model * vec4f(in.normal, 0.0)).xyz);
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
    let L  = normalize(vec3f(1.5, 3.0, 2.0));
    let L2 = normalize(vec3f(-1.0, 1.0, -1.0));
    let V  = normalize(uni.cameraPos - in.world_pos);
    let N  = normalize(in.world_normal);

    let diffuse  = max(0.0, dot(N, L));
    let diffuse2 = max(0.0, dot(N, L2)) * 0.35;
    let H        = normalize(L + V);
    let spec     = pow(max(0.0, dot(N, H)), 80.0);

    if (uni.isGlass == 1u) {
        // Glass: Fresnel rim + strong specular + very low base alpha
        let NdotV   = abs(dot(N, V));
        let fresnel = pow(1.0 - NdotV, 4.0);          // sharp rim
        let rim     = fresnel * 0.65;                   // rim highlight intensity

        // Tinted glass — pale blue-white
        let glassBase  = vec3f(0.82, 0.92, 1.00);
        let glassLight = glassBase * (0.08 + diffuse * 0.25 + diffuse2) + spec * 0.90;

        // Alpha: near-transparent on face, opaque on rim
        let alpha = clamp(0.08 + rim * 0.60 + spec * 0.40, 0.0, 0.92);

        return vec4f(glassLight + rim * vec3f(0.9, 0.95, 1.0), alpha);
    } else {
        // Opaque metal / jacket
        let metalColor = uni.color.rgb;
        let lit = metalColor * (0.18 + diffuse * 0.75 + diffuse2) + spec * 0.20;
        return vec4f(lit, 1.0);
    }
}
