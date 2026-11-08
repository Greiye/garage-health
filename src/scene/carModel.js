import * as THREE from 'three';

// Builds an original, stylized vehicle from primitives. Every maintainable
// item lives in its own "slot" group so it can be colored, picked and
// exploded independently. Coordinates: +x forward, +y up, +z left.
//
// The body shape is parametric per body type so the same builder serves a
// coupe, sedan, hatch, SUV or pickup.

const DIMS = {
  coupe: { L: 4.65, W: 1.85, H: 1.33, wb: 2.57, tw: 1.53, r: 0.33, ride: 0.14 },
  sedan: { L: 4.85, W: 1.84, H: 1.45, wb: 2.75, tw: 1.58, r: 0.33, ride: 0.15 },
  hatch: { L: 4.25, W: 1.78, H: 1.47, wb: 2.6, tw: 1.53, r: 0.31, ride: 0.15 },
  suv: { L: 4.8, W: 1.92, H: 1.75, wb: 2.85, tw: 1.64, r: 0.37, ride: 0.21 },
  truck: { L: 5.8, W: 2.0, H: 1.92, wb: 3.6, tw: 1.7, r: 0.4, ride: 0.26 },
};

export function dimsFor(bodyType) {
  return DIMS[bodyType] || DIMS.coupe;
}

const matCache = [];
function slotMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.55, metalness: 0.25, emissive: 0x000000 });
  matCache.push(m);
  return m;
}

// Side profile (x, y) for the lower body and the greenhouse.
function profiles(type, d) {
  const fx = d.L / 2, rx = -d.L / 2, y0 = d.ride + 0.12, belt = d.H * 0.6;
  switch (type) {
    case 'truck':
      return {
        lower: [[rx, y0], [fx, y0], [fx, belt - 0.05], [fx - 0.25, belt + 0.05], [fx - 1.35, belt + 0.08], [rx + 0.05, belt + 0.05], [rx, belt - 0.1]],
        cabin: [[fx - 1.35, belt + 0.05], [fx - 1.95, d.H], [rx + 2.25, d.H], [rx + 2.05, belt + 0.05]],
        bed: true,
      };
    case 'suv':
      return {
        lower: [[rx, y0], [fx, y0], [fx, belt - 0.1], [fx - 0.25, belt + 0.02], [fx - 1.1, belt + 0.08], [rx + 0.05, belt + 0.08], [rx, belt - 0.05]],
        cabin: [[fx - 1.1, belt + 0.05], [fx - 1.75, d.H], [rx + 0.3, d.H - 0.02], [rx + 0.12, belt + 0.05]],
      };
    case 'hatch':
      return {
        lower: [[rx, y0], [fx, y0], [fx, belt - 0.12], [fx - 0.2, belt], [fx - 0.95, belt + 0.06], [rx + 0.05, belt + 0.06], [rx, belt - 0.08]],
        cabin: [[fx - 0.95, belt + 0.04], [fx - 1.7, d.H], [rx + 0.55, d.H - 0.03], [rx + 0.12, belt + 0.04]],
      };
    case 'sedan':
      return {
        lower: [[rx, y0], [fx, y0], [fx, belt - 0.12], [fx - 0.2, belt], [fx - 1.15, belt + 0.06], [rx + 0.15, belt + 0.08], [rx, belt - 0.05]],
        cabin: [[fx - 1.15, belt + 0.04], [fx - 1.85, d.H], [rx + 1.45, d.H - 0.02], [rx + 0.75, belt + 0.06]],
      };
    default: // coupe, long hood fastback
      return {
        lower: [[rx, y0], [fx, y0], [fx, belt - 0.14], [fx - 0.12, belt - 0.04], [fx - 1.45, belt + 0.05], [rx + 0.2, belt + 0.08], [rx + 0.02, belt - 0.02], [rx, belt - 0.1]],
        cabin: [[fx - 1.45, belt + 0.03], [fx - 2.1, d.H], [rx + 1.55, d.H - 0.04], [rx + 0.35, belt + 0.06]],
      };
  }
}

function extrudeProfile(points, width, bevel = 0.06, holes = []) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  for (const h of holes) s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 18 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

// Lower body with wheel arches cut out.
function lowerBody(points, d) {
  // Bottom edge runs rear→front with an arch over each wheel.
  const [[rx, y0], [fx]] = points;
  const R = d.r + 0.07, cy = d.ride + d.r - 0.02;
  const th = Math.asin(Math.min(0.99, (cy - y0) / R));
  const dx = Math.cos(th) * R;
  const s = new THREE.Shape();
  s.moveTo(rx, y0);
  for (const cx of [-d.wb / 2, d.wb / 2]) {
    s.lineTo(cx - dx, y0);
    s.absarc(cx, cy, R, Math.PI + th, -th, true);
  }
  s.lineTo(fx, y0);
  for (const [x, y] of points.slice(2)) s.lineTo(x, y);
  s.closePath();
  const bevel = 0.07, width = d.W;
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

export function buildVehicle(opts, bodyColor = '#b0181f') {
  const d = dimsFor(opts.bodyType);
  const root = new THREE.Group();
  const slots = new Map();
  const fa = d.wb / 2, ra = -d.wb / 2, ay = d.ride + d.r - 0.02; // axle height
  const halfT = d.tw / 2;
  const trans = opts.engineMount === 'transverse';
  const rwd = opts.drivetrain === 'rwd' || opts.drivetrain === '4wd';
  const fwdLike = opts.drivetrain === 'fwd' || opts.drivetrain === 'awd';

  const slot = (name, label) => {
    if (slots.has(name)) return slots.get(name);
    const g = new THREE.Group();
    g.name = name;
    g.userData = { slot: name, label, material: slotMaterial() };
    slots.set(name, g);
    root.add(g);
    return g;
  };
  const put = (slotName, label, geo, pos = [0, 0, 0], rot) => {
    const g = slot(slotName, label);
    const m = new THREE.Mesh(geo, g.userData.material);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.userData.slot = slotName;
    g.add(m);
    return m;
  };
  const box = (w, h, dd) => new THREE.BoxGeometry(w, h, dd);
  const cyl = (rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const tube = (pts, r = 0.025, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed), Math.max(8, pts.length * 8), r, 8, closed);
  const RX = [Math.PI / 2, 0, 0], RZ = [0, 0, Math.PI / 2];

  // ---------- Body (not a slot; x-ray toggle) ----------
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.25, metalness: 0.4, clearcoat: 0.8, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb7c9, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const body = new THREE.Group();
  body.name = 'body';
  const pr = profiles(opts.bodyType, d);
  body.add(new THREE.Mesh(lowerBody(pr.lower, d), bodyMat));
  const cabin = new THREE.Mesh(extrudeProfile(pr.cabin, d.W * 0.86, 0.05), glassMat);
  body.add(cabin);
  if (pr.bed) {
    const bed = new THREE.Mesh(box(d.L * 0.36, 0.06, d.W * 0.9), bodyMat);
    bed.position.set(-d.L / 2 + d.L * 0.19, d.ride + 0.5, 0);
    body.add(bed);
  }
  body.userData = { bodyMat, glassMat };
  root.add(body);

  // ---------- Tires, wheels, hubs, brakes ----------
  const corners = { FL: [fa, halfT], FR: [fa, -halfT], RL: [ra, halfT], RR: [ra, -halfT] };
  const tireW = 0.24;
  for (const [k, [x, z]] of Object.entries(corners)) {
    const side = Math.sign(z);
    const tg = new THREE.TorusGeometry(d.r - 0.075, 0.085, 14, 36);
    tg.scale(1, 1, tireW / 0.17);
    put(`tire_${k}`, `Tire ${k}`, tg, [x, ay, z], [0, 0, 0]);
    put(`tire_${k}`, `Tire ${k}`, cyl(d.r - 0.1, d.r - 0.1, tireW * 0.8, 24), [x, ay, z], RX); // rim face
    put(`hub_${k}`, `Hub ${k}`, cyl(0.07, 0.07, 0.12, 16), [x, ay, z - side * 0.2], RX);
    put(`brake_${k}`, `Brakes ${k}`, cyl(d.r - 0.12, d.r - 0.12, 0.028, 28), [x, ay, z - side * 0.14], RX);
    put(`brake_${k}`, `Brakes ${k}`, box(0.12, 0.16, 0.08), [x - 0.13, ay + 0.12, z - side * 0.15], [0, 0, 0.6]);
    // Tap target for the brake spot: an invisible disc on the outer face of the wheel,
    // so a press on the brake (not the tire) opens Brakes. Hit-tested first in the viewer.
    const proxy = new THREE.Mesh(cyl(d.r * 0.42, d.r * 0.42, 0.05, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    proxy.rotation.set(Math.PI / 2, 0, 0);
    proxy.position.set(x, ay, z + side * (tireW * 0.5 + 0.03));
    proxy.userData = { slot: `brake_${k}`, proxy: true };
    slot(`brake_${k}`, `Brakes ${k}`).add(proxy);
  }
  if (opts.spare) put('spare', 'Spare tire', cyl(d.r - 0.04, d.r - 0.04, 0.16, 24), opts.bodyType === 'truck' ? [ra - 0.55, d.ride + 0.15, 0] : [-d.L / 2 + 0.55, d.ride + 0.28, 0], [0, 0, 0]);

  // ---------- Front suspension ----------
  for (const k of ['FL', 'FR']) {
    const [x, z] = corners[k];
    const s = Math.sign(z), zi = z - s * 0.3;
    if (opts.frontSuspension === 'strut') {
      put(`damper_${k}`, `Strut ${k}`, cyl(0.035, 0.035, 0.55), [x - 0.02, ay + 0.33, zi], [s * 0.18, 0, 0]);
    } else {
      put(`damper_${k}`, `Shock ${k}`, cyl(0.03, 0.03, 0.4), [x - 0.08, ay + 0.15, zi - s * 0.08], [s * 0.12, 0, 0]);
    }
    const spY = opts.frontSuspension === 'strut' ? ay + 0.42 : ay + 0.08;
    put(`spring_${k}`, `Spring ${k}`, helix(0.075, 0.28, 6), [x - 0.02, spY - 0.14, zi - s * 0.02], [0, 0, 0]);
    put(`arm_${k}`, `Control arm ${k}`, box(0.3, 0.035, 0.38), [x - 0.05, ay - 0.13, z - s * 0.42], [0, 0.35 * s, 0]);
    if (opts.frontSuspension === 'wishbone') put(`arm_${k}`, `Control arm ${k}`, box(0.22, 0.03, 0.28), [x - 0.05, ay + 0.2, z - s * 0.4], [0, 0.3 * s, 0]);
  }
  // Steering
  put('steering', 'Steering', cyl(0.035, 0.035, d.tw - 0.55), [fa - 0.12, ay - 0.04, 0], RX);
  for (const [s, z] of [['L', 1], ['R', -1]]) put(`tierod_${s}`, `Tie rod ${s}`, cyl(0.015, 0.015, 0.33), [fa - 0.14, ay - 0.04, z * (halfT - 0.28)], RX);

  // ---------- Rear suspension ----------
  for (const k of ['RL', 'RR']) {
    const [x, z] = corners[k];
    const s = Math.sign(z), zi = z - s * 0.32;
    put(`damper_${k}`, `Shock ${k}`, cyl(0.028, 0.028, 0.42), [x - 0.12, ay + 0.15, zi], [0, 0, -0.15]);
    if (opts.rearSuspension === 'leaf') {
      put(`spring_${k}`, `Leaf spring ${k}`, leaf(1.4), [x, ay - 0.1, z - s * 0.45], [0, 0, 0]);
    } else {
      put(`spring_${k}`, `Spring ${k}`, helix(0.07, 0.24, 5), [x + 0.1, ay + 0.04, zi - s * 0.08], [0, 0, 0]);
    }
    if (opts.rearSuspension !== 'leaf') {
      put(`arm_${k}`, `Control arm ${k}`, box(0.55, 0.04, 0.05), [x + 0.38, ay - 0.1, z - s * 0.42], [0, 0, 0.12]);
      if (opts.rearSuspension === 'solid') put(`arm_${k}`, `Control arm ${k}`, box(0.36, 0.035, 0.05), [x + 0.25, ay + 0.15, z - s * 0.6], [0, s * 0.35, -0.1]);
    }
  }
  // Sway bars
  put('sway_F', 'Front sway bar', tube([[fa - 0.05, ay - 0.05, halfT - 0.35], [fa + 0.12, ay - 0.08, halfT - 0.55], [fa + 0.15, ay - 0.08, 0], [fa + 0.12, ay - 0.08, -halfT + 0.55], [fa - 0.05, ay - 0.05, -halfT + 0.35]], 0.018), [0, 0, 0]);
  put('sway_R', 'Rear sway bar', tube([[ra + 0.2, ay - 0.02, halfT - 0.38], [ra + 0.05, ay - 0.06, halfT - 0.5], [ra - 0.05, ay - 0.06, 0], [ra + 0.05, ay - 0.06, -halfT + 0.5], [ra + 0.2, ay - 0.02, -halfT + 0.38]], 0.016), [0, 0, 0]);

  // ---------- Engine bay ----------
  const ey = d.ride + 0.48; // engine center height
  const ex = fa - 0.35; // engine center x (front-mid)
  const eL = 0.25 + opts.cylinders * 0.055, eW = opts.layout === 'V' ? 0.6 : 0.36;
  const engRot = trans ? [0, Math.PI / 2, 0] : [0, 0, 0];
  const E = (lx, ly, lz) => (trans ? [ex + lz * -1, ly, lx] : [ex + lx, ly, lz]); // local→world
  put('engine', 'Engine', rotGeo(box(eL, 0.32, eW * 0.55), engRot), E(0, ey - 0.02, 0));
  if (opts.layout === 'V') {
    put('engine', 'Engine', rotGeo(box(eL, 0.15, 0.26), [engRot[0] + 0.6, engRot[1], 0]), E(0, ey + 0.14, 0.2));
    put('engine', 'Engine', rotGeo(box(eL, 0.15, 0.26), [engRot[0] - 0.6, engRot[1], 0]), E(0, ey + 0.14, -0.2));
  } else {
    put('engine', 'Engine', rotGeo(box(eL, 0.16, 0.28), engRot), E(0, ey + 0.22, 0));
  }
  put('intake', 'Intake manifold', rotGeo(box(eL * 0.85, 0.1, 0.24), engRot), E(0, ey + 0.27, 0));
  put('oil', 'Oil pan & filter', rotGeo(box(eL * 0.9, 0.12, eW * 0.5), engRot), E(0, ey - 0.25, 0));
  put('oil', 'Oil pan & filter', cyl(0.045, 0.045, 0.12), E(0.05, ey - 0.12, eW * 0.4), trans ? [0, 0, 0] : [0, 0, 0]);
  put('throttle', 'Throttle body', rotGeo(cyl(0.06, 0.06, 0.08), [0, 0, Math.PI / 2]), E(eL / 2 + 0.06, ey + 0.27, 0));
  put('fuelRail', 'Fuel rail & injectors', rotGeo(cyl(0.012, 0.012, eL * 0.8), [0, 0, Math.PI / 2]), E(0, ey + 0.23, 0.12));
  if (opts.layout === 'V') put('fuelRail', 'Fuel rail & injectors', rotGeo(cyl(0.012, 0.012, eL * 0.8), [0, 0, Math.PI / 2]), E(0, ey + 0.23, -0.12));
  // Plugs along heads, coil pack on top front
  const nPerBank = opts.layout === 'V' ? Math.ceil(opts.cylinders / 2) : opts.cylinders;
  for (let i = 0; i < nPerBank; i++) {
    const lx = -eL / 2 + (eL / nPerBank) * (i + 0.5);
    if (opts.layout === 'V') {
      put('plugs', 'Spark plugs', cyl(0.012, 0.012, 0.09), E(lx, ey + 0.13, 0.36), trans ? [0, 0, 0.9] : [0.9, 0, 0]);
      put('plugs', 'Spark plugs', cyl(0.012, 0.012, 0.09), E(lx, ey + 0.13, -0.36), trans ? [0, 0, -0.9] : [-0.9, 0, 0]);
    } else {
      put('plugs', 'Spark plugs', cyl(0.012, 0.012, 0.09), E(lx, ey + 0.33, 0.06));
    }
  }
  if (opts.plugWires) put('coils', 'Coil pack', rotGeo(box(0.12, 0.08, 0.16), engRot), E(eL / 2 - 0.05, ey + 0.36, 0.12));
  else for (let i = 0; i < nPerBank; i++) {
    const lx = -eL / 2 + (eL / nPerBank) * (i + 0.5);
    put('coils', 'Ignition coils', cyl(0.025, 0.025, 0.07), E(lx, ey + 0.38, opts.layout === 'V' ? 0.2 : 0.06));
    if (opts.layout === 'V') put('coils', 'Ignition coils', cyl(0.025, 0.025, 0.07), E(lx, ey + 0.38, -0.2));
  }
  // Front of engine accessories
  const front = eL / 2 + 0.05;
  put('belt', 'Serpentine belt', rotGeo(beltLoop(0.16, 0.12), trans ? [0, 0, 0] : [0, Math.PI / 2, 0]), E(front + 0.02, ey + 0.02, 0));
  put('waterPump', 'Water pump', rotGeo(cyl(0.06, 0.06, 0.06), [0, 0, Math.PI / 2]), E(front, ey + 0.07, 0));
  put('thermostat', 'Thermostat', cyl(0.035, 0.035, 0.05), E(front - 0.05, ey + 0.24, 0.05));
  put('alternator', 'Alternator', rotGeo(cyl(0.07, 0.07, 0.13), [0, 0, Math.PI / 2]), E(front - 0.02, ey + 0.16, -0.22));
  put('psReservoir', 'Power steering', rotGeo(cyl(0.055, 0.055, 0.08), [0, 0, Math.PI / 2]), E(front - 0.02, ey + 0.12, 0.25));
  put('starter', 'Starter', rotGeo(cyl(0.05, 0.05, 0.18), [0, 0, Math.PI / 2]), E(-eL / 2 - 0.02, ey - 0.15, -0.2));
  put('mounts', 'Engine & trans mounts', box(0.08, 0.06, 0.08), E(0, ey - 0.2, 0.3));
  put('mounts', 'Engine & trans mounts', box(0.08, 0.06, 0.08), E(0, ey - 0.2, -0.3));

  // Radiator & hoses (always across the nose)
  const radX = d.L / 2 - 0.32;
  put('radiator', 'Radiator', box(0.05, 0.42, d.W * 0.62), [radX, d.ride + 0.42, 0]);
  put('hoses', 'Hoses', tube([[radX - 0.03, d.ride + 0.58, 0.2], [radX - 0.2, d.ride + 0.62, 0.15], [ex + eL / 2 * (trans ? 0 : 1) + 0.02, ey + 0.24, 0.05]], 0.022));
  put('hoses', 'Hoses', tube([[radX - 0.03, d.ride + 0.28, -0.22], [radX - 0.2, d.ride + 0.28, -0.12], [ex + eL / 2 * (trans ? 0 : 1) + 0.03, ey + 0.07, 0]], 0.022));
  // Airbox, battery, brake master, cabin filter
  put('airbox', 'Air box & MAF', box(0.26, 0.15, 0.22), [radX - 0.22, d.ride + 0.62, -d.W * 0.3]);
  put('airbox', 'Air box & MAF', tube([[radX - 0.35, d.ride + 0.64, -d.W * 0.3], [ex + 0.3, ey + 0.32, -0.15], [ex + eL / 2 + 0.1, ey + 0.28, 0]], 0.04));
  put('battery', 'Battery', box(0.26, 0.2, 0.18), [radX - 0.25, d.ride + 0.6, d.W * 0.32]);
  const fw = fa - 0.85; // firewall x
  put('brakeMaster', 'Brake master cylinder', rotGeo(cyl(0.05, 0.05, 0.18), [0, 0, Math.PI / 2]), [fw + 0.05, d.ride + 0.72, d.W * 0.28]);
  put('brakeMaster', 'Brake master cylinder', cyl(0.13, 0.13, 0.06), [fw - 0.05, d.ride + 0.72, d.W * 0.28], [0, 0, Math.PI / 2]);
  if (opts.cabinFilter) put('cabin', 'Cabin filter', box(0.04, 0.18, 0.24), [fw - 0.12, d.ride + 0.62, -d.W * 0.2]);
  put('interior', 'Cabin & body', box(0.1, 0.12, d.W * 0.55), [fw - 0.35, d.ride + 0.55, 0]);
  put('wipers', 'Wipers', box(0.03, 0.02, d.W * 0.7), [fw - 0.06, d.H * 0.6 + 0.08, 0], [0, 0.2, 0]);
  put('headlights', 'Headlights', box(0.06, 0.08, 0.3), [d.L / 2 - 0.05, d.H * 0.6 - 0.08, d.W * 0.33]);
  put('headlights', 'Headlights', box(0.06, 0.08, 0.3), [d.L / 2 - 0.05, d.H * 0.6 - 0.08, -d.W * 0.33]);
  put('taillights', 'Tail lights', box(0.05, 0.1, 0.34), [-d.L / 2 + 0.03, d.H * 0.6 - 0.12, d.W * 0.32]);
  put('taillights', 'Tail lights', box(0.05, 0.1, 0.34), [-d.L / 2 + 0.03, d.H * 0.6 - 0.12, -d.W * 0.32]);

  // ---------- Drivetrain ----------
  const bellX = trans ? ex : ex - eL / 2 - 0.08;
  if (trans) {
    // Transaxle beside the engine
    put('clutch', 'Clutch / converter', rotGeo(cyl(0.16, 0.16, 0.1), [Math.PI / 2, 0, 0]), [ex, ey - 0.05, eL / 2 + 0.08]);
    put('transmission', 'Transaxle', box(0.36, 0.3, 0.3), [ex - 0.08, ey - 0.08, eL / 2 + 0.27]);
  } else {
    put('clutch', opts.trans === 'manual' ? 'Clutch & bellhousing' : 'Torque converter', rotGeo(cyl(0.17, 0.2, 0.18), RZ), [bellX, ey - 0.04, 0]);
    put('transmission', 'Transmission', rotGeo(cyl(0.09, 0.15, 0.62), RZ), [bellX - 0.4, ey - 0.08, 0]);
  }
  const tailX = trans ? ex - 0.2 : bellX - 0.72;
  const diffY = ay + 0.02;
  if (opts.drivetrain === '4wd' || (opts.drivetrain === 'awd' && !trans)) {
    put('transferCase', 'Transfer case', box(0.24, 0.24, 0.2), [tailX - 0.1, ey - 0.1, 0.05]);
  } else if (opts.drivetrain === 'awd') {
    put('transferCase', 'Power transfer unit', box(0.18, 0.18, 0.18), [ex - 0.25, ey - 0.18, eL / 2 + 0.1]);
  }
  if (rwd || opts.drivetrain === 'awd') {
    const dsStart = opts.drivetrain === 'awd' && trans ? [ex - 0.3, ey - 0.2, 0] : [tailX - 0.2, ey - 0.1, 0];
    const dsEnd = [ra + 0.22, diffY, 0];
    const len = Math.hypot(dsEnd[0] - dsStart[0], dsEnd[1] - dsStart[1]);
    const mid = dsStart.map((v, i) => (v + dsEnd[i]) / 2);
    const ang = Math.atan2(dsEnd[1] - dsStart[1], dsEnd[0] - dsStart[0]);
    put('driveshaft', 'Driveshaft', rotGeo(cyl(0.04, 0.04, len), [0, 0, Math.PI / 2 + ang]), mid);
    put('driveshaft', 'Driveshaft', new THREE.SphereGeometry(0.05, 12, 10), dsStart);
    put('driveshaft', 'Driveshaft', new THREE.SphereGeometry(0.05, 12, 10), dsEnd);
    put('differential', 'Rear differential', new THREE.SphereGeometry(0.15, 20, 16), [ra, diffY, 0]);
    put('differential', 'Rear differential', rotGeo(cyl(0.12, 0.13, 0.08), RZ), [ra + 0.13, diffY, 0]);
    if (opts.rearSuspension === 'solid' || opts.rearSuspension === 'leaf') {
      put('rearAxle', 'Rear axle', cyl(0.05, 0.05, d.tw - 0.4), [ra, ay, 0], RX);
    } else {
      put('rearCv_L', 'Rear CV axle L', cyl(0.025, 0.025, halfT - 0.35), [ra, ay, (halfT - 0.15) / 2 + 0.05], RX);
      put('rearCv_R', 'Rear CV axle R', cyl(0.025, 0.025, halfT - 0.35), [ra, ay, -(halfT - 0.15) / 2 - 0.05], RX);
    }
  }
  if (fwdLike || opts.drivetrain === '4wd') {
    const cz = trans ? eL / 2 + 0.2 : 0;
    put('frontCv_L', 'Front CV axle L', tube([[fa - 0.05, ay, cz * 0.5 + 0.12], [fa, ay, halfT - 0.2]], 0.025));
    put('frontCv_R', 'Front CV axle R', tube([[fa - 0.05, ay, cz * 0.5 - 0.12], [fa, ay, -halfT + 0.2]], 0.025));
  }
  if (opts.drivetrain === '4wd') {
    put('frontDiff', 'Front differential', new THREE.SphereGeometry(0.12, 16, 12), [fa - 0.05, ay, 0.12]);
    const s = [tailX - 0.1, ey - 0.15, 0.12], e = [fa - 0.15, ay, 0.12];
    put('frontDriveshaft', 'Front driveshaft', tube([s, e], 0.03));
  }

  // ---------- Fuel ----------
  const tankX = opts.bodyType === 'truck' ? -0.2 : ra + 0.55;
  put('fuelTank', 'Fuel tank', box(0.55, 0.2, d.W * 0.6), [tankX, d.ride + 0.2, 0]);
  put('fuelPump', 'Fuel pump', cyl(0.06, 0.06, 0.08), [tankX + 0.05, d.ride + 0.34, 0.12]);
  put('fuelFilter', 'Fuel filter', rotGeo(cyl(0.035, 0.035, 0.16), RZ), [tankX + 0.6, d.ride + 0.1, -d.W * 0.35]);

  // ---------- Exhaust ----------
  const banksN = opts.layout === 'V' ? 2 : 1;
  const muffX = -d.L / 2 + 0.55;
  for (let b = 0; b < banksN; b++) {
    const s = banksN === 2 ? (b === 0 ? 1 : -1) : -1;
    const z = s * (banksN === 2 ? 0.22 : 0.15);
    const catX = ex - 0.5 - (trans ? 0 : eL / 2);
    const start = trans ? [ex + 0.2, ey - 0.05, z] : [ex, ey - 0.02, s * (eW / 2 + 0.05)];
    put('exhaust', 'Exhaust', tube([start, [catX + 0.3, d.ride + 0.12, z], [catX - 0.25, d.ride + 0.08, z], [muffX + 0.5, d.ride + 0.1, (opts.dualExhaust || banksN === 1) ? z : 0]], 0.03));
    put(`cat_${b + 1}`, `Catalytic converter bank ${b + 1}`, rotGeo(cyl(0.07, 0.07, 0.3), RZ), [catX, d.ride + 0.09, z]);
    put(`o2_${b + 1}`, `O2 sensors bank ${b + 1}`, cyl(0.015, 0.015, 0.08), [catX + 0.28, d.ride + 0.17, z]);
    put(`o2_${b + 1}`, `O2 sensors bank ${b + 1}`, cyl(0.015, 0.015, 0.08), [catX - 0.26, d.ride + 0.13, z]);
  }
  const mufflers = opts.dualExhaust ? [0.35, -0.35] : [-0.3];
  for (const z of mufflers) {
    put('muffler', 'Muffler', rotGeo(new THREE.CapsuleGeometry(0.1, 0.32, 6, 14), RZ), [muffX, d.ride + 0.14, z * (d.W / 1.85)]);
    put('exhaust', 'Exhaust', rotGeo(cyl(0.035, 0.035, 0.4), RZ), [muffX - 0.35, d.ride + 0.14, z * (d.W / 1.85)]);
  }

  // Remember rest positions for the exploded view.
  for (const g of slots.values()) {
    const bb = new THREE.Box3().setFromObject(g);
    g.userData.center = bb.getCenter(new THREE.Vector3());
  }
  return { root, slots, body, dims: d };
}

function rotGeo(g, [x, y, z]) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z));
  g.applyMatrix4(m);
  return g;
}

function helix(r, h, turns) {
  const pts = [];
  const n = turns * 16;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t) * r, (i / n) * h, Math.sin(t) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.011, 6, false);
}

function leaf(len) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const x = -len / 2 + (len * i) / 20;
    pts.push(new THREE.Vector3(x, -0.08 * (1 - (2 * x / len) ** 2), 0));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.025, 6, false);
}

function beltLoop(w, h) {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, Math.sin(t) * h, Math.cos(t) * w));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.012, 6, true);
}
