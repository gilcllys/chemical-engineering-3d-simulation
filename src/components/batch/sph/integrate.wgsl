struct Particle {
    position: vec3f,
    v: vec3f,
    force: vec3f,
    density: f32,
    nearDensity: f32,
}

struct SPHParams {
    mass: f32,
    kernelRadius: f32,
    kernelRadiusPow2: f32,
    kernelRadiusPow5: f32,
    kernelRadiusPow6: f32,
    kernelRadiusPow9: f32,
    dt: f32,
    stiffness: f32,
    nearStiffness: f32,
    restDensity: f32,
    viscosity: f32,
    n: u32,
}

struct ImpellerParams {
    impellerY: f32,
    impellerR: f32,
    impellerH: f32,
    shaftR: f32,
    reactorR: f32,
    reactorBot: f32,
    liquidFillY: f32,
    agitSpeed: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SPHParams;
@group(0) @binding(2) var<uniform> imp: ImpellerParams;

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.n) { return; }

  var pos = particles[id.x].position;
  var vel = particles[id.x].v;
  var a   = vec3f(0.0);

  if (particles[id.x].density != 0.) {
    a = particles[id.x].force / particles[id.x].density;
  }

  // Gravity
  a.y -= 0.5;

  let rVec = vec2f(pos.x, pos.z);
  let r    = length(rVec);
  let ang  = atan2(pos.z, pos.x);

  // Impeller direct zone: tangential + radial Rushton
  let dyImp = pos.y - imp.impellerY;
  if (r < imp.impellerR && abs(dyImp) < imp.impellerH * 3.0) {
    let tFade = 1.0 - r / imp.impellerR;
    a.x += cos(ang + 1.5708) * imp.agitSpeed * 80.0 * tFade;
    a.z += sin(ang + 1.5708) * imp.agitSpeed * 80.0 * tFade;
    if (r > 0.001) {
      let nr = normalize(rVec);
      a.x += nr.x * imp.agitSpeed * 40.0 * tFade;
      a.z += nr.y * imp.agitSpeed * 40.0 * tFade;
    }
  }

  // Subtle vortex depression on the surface only (+10% effect)
  // Pull center particles very slightly downward near the free surface
  let nearSurface = max(0.0, 1.0 - abs(pos.y - imp.liquidFillY) / 0.18);
  let nearCenter  = max(0.0, 1.0 - r / (imp.reactorR * 0.30));
  a.y -= imp.agitSpeed * 0.8 * nearSurface * nearCenter;

  // Integrate
  vel += params.dt * a;
  pos += params.dt * vel;

  // Hard clamp: cylinder outer wall
  let rNew  = length(vec2f(pos.x, pos.z));
  let hardR = imp.reactorR - 0.001;
  if (rNew > hardR) {
    let nr = normalize(vec2f(pos.x, pos.z));
    pos.x = nr.x * hardR;
    pos.z = nr.y * hardR;
    let vr = vel.x * nr.x + vel.z * nr.y;
    if (vr > 0.0) {
      vel.x -= vr * nr.x * 1.2;
      vel.z -= vr * nr.y * 1.2;
    }
  }

  // Hard clamp: floor
  if (pos.y < imp.reactorBot) {
    pos.y = imp.reactorBot;
    if (vel.y < 0.0) { vel.y = -vel.y * 0.2; }
  }

  // Hard clamp: free surface
  if (pos.y > imp.liquidFillY) {
    pos.y = imp.liquidFillY;
    if (vel.y > 0.0) { vel.y = -vel.y * 0.2; }
  }

  // Hard clamp: shaft
  let rXZ = length(vec2f(pos.x, pos.z));
  if (rXZ < imp.shaftR + 0.001 && rXZ > 0.0001) {
    let ns = normalize(vec2f(pos.x, pos.z));
    pos.x = ns.x * (imp.shaftR + 0.001);
    pos.z = ns.y * (imp.shaftR + 0.001);
    let vs = vel.x * ns.x + vel.z * ns.y;
    if (vs < 0.0) {
      vel.x -= vs * ns.x * 1.2;
      vel.z -= vs * ns.y * 1.2;
    }
  }

  // Speed cap
  let speed = length(vel);
  if (speed > 4.0) { vel = vel * (4.0 / speed); }

  particles[id.x].position = pos;
  particles[id.x].v        = vel;
}
