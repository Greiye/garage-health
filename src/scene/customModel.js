import * as THREE from 'three';
import Dexie from 'dexie';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// A vehicle's own 3D model (.glb) imported by the user. Kept in a separate
// IndexedDB database on this device only: never synced, backed up or
// exported, so a model with a personal-use license stays on the device.
const mdb = new Dexie('garage-health-models');
mdb.version(1).stores({ models: 'vehicleId' });

export const getCustomModel = (vehicleId) => mdb.models.get(vehicleId);
export const removeCustomModel = (vehicleId) => { cache.delete(vehicleId); return mdb.models.delete(vehicleId); };
export async function saveCustomModel(vehicleId, file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) !== 'glTF') throw new Error('That file is not a .glb model. Export it as glTF Binary (.glb).');
  const gltf = await parse(file); // fail now, not on every load
  const rec = { vehicleId, name: file.name, size: file.size, blob: file, addedAt: new Date().toISOString() };
  await mdb.models.put(rec);
  cache.set(vehicleId, { addedAt: rec.addedAt, gltf });
  return rec;
}

// Placeholder for the 2001 Mustang until the user imports their own model.
const PLACEHOLDER = `${import.meta.env.BASE_URL}models/placeholder-mustang.glb`;
export const placeholderFor = (vehicle) => (vehicle?.presetId || '').startsWith('mustang-2001');
let placeholderGltf = null;
async function loadPlaceholder() {
  if (!placeholderGltf) {
    const buf = await (await fetch(PLACEHOLDER)).arrayBuffer();
    placeholderGltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, '', res, rej));
  }
  return placeholderGltf.scene.clone(true);
}
// The model to draw for this vehicle: the user's own, else the placeholder (Mustang only), else null.
export async function loadModelScene(vehicle) {
  const own = await loadCustomScene(vehicle.id);
  if (own) return { scene: own, kind: 'custom' };
  if (placeholderFor(vehicle)) return { scene: await loadPlaceholder(), kind: 'placeholder' };
  return null;
}

const cache = new Map(); // vehicleId -> { addedAt, gltf }
async function parse(blob) {
  const buf = await blob.arrayBuffer();
  return new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, '', res, (e) => rej(new Error(`Couldn't read the model: ${e?.message || e}`))));
}
export async function loadCustomScene(vehicleId) {
  const rec = await getCustomModel(vehicleId);
  if (!rec) return null;
  let c = cache.get(vehicleId);
  if (!c || c.addedAt !== rec.addedAt) { c = { addedAt: rec.addedAt, gltf: await parse(rec.blob) }; cache.set(vehicleId, c); }
  return c.gltf.scene.clone(true);
}

const WHEEL = /wheel[\s_]*(front|rear)[\s_]*(l|r)(?![a-z])/i;
const CALIPER = /cal+i?p+er[\s_]*(front|rear)[\s_]*(l|r)(?![a-z])/i;

function findTagged(root, re) {
  const out = [];
  const walk = (o) => { if (re.test(o.name)) { out.push(o); return; } o.children.forEach(walk); };
  walk(root);
  return out;
}
const centerOf = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());

// Fit the model to the app's coordinates (+x forward, +y up, +z left), scaled
// so its wheelbase matches the vehicle and its wheel centers sit at axle height.
// Returns { group, wheels: [{obj, corner}], calipers: [{obj, corner}], paint, xray }.
export function fitCustomModel(scene, d, bodyColor) {
  const inner = new THREE.Group();
  inner.add(scene);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.updateMatrixWorld(true);

  // Length axis = longer horizontal side; front = where the engine is.
  const bb = new THREE.Box3().setFromObject(scene);
  const size = bb.getSize(new THREE.Vector3()), mid = bb.getCenter(new THREE.Vector3());
  const alongZ = size.z > size.x;
  let engine = null;
  scene.traverse((o) => { if (!engine && o.isMesh && /engine/i.test(o.name)) engine = o; });
  let sign = 1;
  if (engine) { const e = centerOf(engine); sign = Math.sign((alongZ ? e.z - mid.z : e.x - mid.x) || 1); }
  // Rotate so the front points at +x.
  inner.rotation.y = alongZ ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : (sign > 0 ? 0 : Math.PI);
  outer.updateMatrixWorld(true);

  const wheels = findTagged(scene, WHEEL);
  const calipers = findTagged(scene, CALIPER);
  let s, refY;
  const wc = wheels.map(centerOf);
  if (wc.length >= 4) {
    const xs = wc.map((c) => c.x), frontX = Math.max(...xs), rearX = Math.min(...xs);
    const front = wc.filter((c) => c.x > (frontX + rearX) / 2), rear = wc.filter((c) => c.x <= (frontX + rearX) / 2);
    const avg = (a) => a.reduce((t, c) => t + c.x, 0) / a.length;
    s = d.wb / (avg(front) - avg(rear));
    inner.scale.setScalar(s);
    outer.updateMatrixWorld(true);
    const wc2 = wheels.map(centerOf);
    const xs2 = wc2.map((c) => c.x), midX = (Math.max(...xs2) + Math.min(...xs2)) / 2;
    refY = wc2.reduce((t, c) => t + c.y, 0) / wc2.length;
    const zc = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3()).z;
    inner.position.set(-midX, d.ride + d.r - 0.02 - refY, -zc);
  } else {
    s = d.L / Math.max(size.x, size.z);
    inner.scale.setScalar(s);
    outer.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(scene), c2 = b2.getCenter(new THREE.Vector3());
    inner.position.set(-c2.x, -b2.min.y + 0.02, -c2.z);
  }
  outer.updateMatrixWorld(true);

  const corner = (o) => { const c = centerOf(o); return `${c.x > 0 ? 'F' : 'R'}${c.z > 0 ? 'L' : 'R'}`; };
  const tag = (list) => list.filter((o) => { let sk = false; o.traverse((m) => { if (m.isSkinnedMesh) sk = true; }); return !sk; }).map((obj) => ({ obj, corner: corner(obj) }));
  const wheelTags = tag(wheels);
  // A caliper counts only if it sits at a wheel; ones left at a rig's origin
  // (some game exports) are hidden and the app's own brakes show instead.
  const wheelCenters = wheelTags.map((w) => ({ c: centerOf(w.obj), corner: w.corner }));
  const caliperTags = [];
  for (const t of tag(calipers)) {
    const c = centerOf(t.obj);
    const near = wheelCenters.find((w) => w.c.distanceTo(c) < d.r * 1.1);
    if (near) caliperTags.push({ obj: t.obj, corner: near.corner }); else t.obj.visible = false;
  }

  // Materials: own copies so x-ray can fade them; heavy glass transmission
  // becomes plain transparency (cheaper on phones); paint takes the vehicle color.
  const mapped = new Set([...wheelTags, ...caliperTags].map((t) => t.obj));
  const xray = [];
  const walkMats = (o, skip) => {
    if (mapped.has(o)) skip = true;
    if (o.isMesh && !skip) {
      const one = (m) => {
        m = m.clone();
        if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.35); m.depthWrite = false; }
        if (/paint/i.test(m.name) && bodyColor) m.color = new THREE.Color(bodyColor);
        xray.push({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
      o.castShadow = true;
    }
    o.children.forEach((c) => walkMats(c, skip));
  };
  walkMats(scene, false);
  return { group: outer, wheels: wheelTags, calipers: caliperTags, xray };
}
