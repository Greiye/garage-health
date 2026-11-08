import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildVehicle } from './carModel.js';
import { loadCustomScene, fitCustomModel } from './customModel.js';
import { LEVELS } from '../data/health.js';

// 3D viewer: orbit/zoom, tap to select a part slot, health colors,
// blinking for red, x-ray body and exploded view.
export class Viewer {
  constructor(container, { onSelect, onHover } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    this.camera.position.set(4.2, 2.6, 4.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.45, 0);
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.95;

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 7, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.PolarGridHelper(6, 12, 6, 48, 0x3b4252, 0x2a2f3a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.explode = 0;
    this.xray = true;
    this.selected = null;
    this.hovered = null;
    this.slotHealth = new Map();
    this.t0 = performance.now();
    this.dirty = true;
    this.controls.addEventListener('change', () => (this.dirty = true));

    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e);
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const s = this.slotAt(e);
      if (s !== this.hovered) {
        this.hovered = s;
        el.style.cursor = s ? 'pointer' : 'grab';
        this.onHover?.(s, e);
      } else if (s) this.onHover?.(s, e);
    });
    el.addEventListener('pointerleave', () => { this.hovered = null; this.onHover?.(null); });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setVehicle(options, bodyColor, vehicleId) {
    if (this.model) this.scene.remove(this.model.root);
    this.customModel = false;
    this.model = buildVehicle(options, bodyColor);
    const token = (this.buildToken = (this.buildToken || 0) + 1);
    if (vehicleId != null) {
      loadCustomScene(vehicleId).then((sc) => { if (sc && token === this.buildToken) this.useCustomModel(sc, bodyColor); })
        .catch((e) => { console.error(e); this.onModelError?.(e); });
    }
    this.scene.add(this.model.root);
    this.setXray(this.xray);
    this.setExplode(this.explode);
    this.applyHealth(this.slotHealth);
    const d = this.model.dims;
    this.controls.target.set(0, d.H * 0.38, 0);
    this.placeCamera();
  }

  // Swap the drawn body for the user's model. Its wheels and calipers join the
  // tire and brake slots (health colors, tap to open); all other app parts stay
  // inside the body for x-ray.
  useCustomModel(scene, bodyColor) {
    const m = this.model;
    const fit = fitCustomModel(scene, m.dims, bodyColor);
    for (const c of [...m.body.children]) c.visible = false;
    m.body.add(fit.group);
    m.body.userData.custom = fit.xray;
    m.root.updateMatrixWorld(true);
    const join = (list, prefix, replace) => {
      for (const { obj, corner } of list) {
        const g = m.slots.get(`${prefix}_${corner}`);
        if (!g) continue;
        if (replace && !g.userData.custom) for (const c of [...g.children]) g.remove(c);
        g.userData.custom = true;
        const saved = g.position.clone();
        g.position.set(0, 0, 0); g.updateMatrixWorld(true);
        g.attach(obj);
        obj.traverse((o) => { if (o.isMesh) { o.material = g.userData.material; o.userData.slot = g.name; o.castShadow = true; } });
        g.userData.center = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
        g.position.copy(saved);
      }
    };
    join(fit.wheels, 'tire', true);
    join(fit.calipers, 'brake', false);
    this.customModel = true;
    this.setXray(this.xray);
    this.setExplode(this.explode);
    this.applyHealth(this.slotHealth);
  }

  applyHealth(slotHealth) {
    this.dirty = true;
    this.slotHealth = slotHealth || new Map();
    if (!this.model) return;
    for (const [name, g] of this.model.slots) {
      const h = this.slotHealth.get(name);
      const color = LEVELS[h?.level || 'unknown'].color;
      g.userData.material.color.set(color);
      g.userData.baseColor = new THREE.Color(color);
      g.userData.blink = !!h?.blink;
    }
    this.applyVisibility(); // only parts that exist on this vehicle
    this.highlight();
  }

  setXray(on) {
    this.dirty = true;
    this.xray = on;
    if (!this.model) return;
    const { bodyMat, glassMat } = this.model.body.userData;
    bodyMat.opacity = on ? 0.13 : 0.96;
    bodyMat.depthWrite = !on;
    glassMat.opacity = on ? 0.08 : 0.35;
    for (const x of this.model.body.userData.custom || []) {
      x.m.transparent = on ? true : x.transparent;
      x.m.opacity = on ? Math.min(x.opacity, 1) * 0.12 : x.opacity;
      x.m.depthWrite = on ? false : x.depthWrite;
      x.m.needsUpdate = true;
    }
    this.model.body.visible = true;
    this.applyVisibility();
  }

  // With the user's own model in solid view, show only the parts mapped onto
  // it (wheels, calipers); the app's drawn parts would poke through the body.
  applyVisibility() {
    if (!this.model) return;
    const solid = this.customModel && !this.xray && this.model.body.visible;
    for (const [name, g] of this.model.slots) g.visible = !!this.slotHealth.get(name) && (!solid || !!g.userData.custom);
  }

  setBodyVisible(v) {
    this.dirty = true;
    if (this.model) this.model.body.visible = v;
    this.applyVisibility();
  }

  setExplode(f) {
    this.dirty = true;
    this.explode = f;
    if (!this.model) return;
    for (const g of this.model.slots.values()) {
      const c = g.userData.center;
      g.position.set(c.x * f * 0.55, Math.max(0, c.y - 0.3) * f * 1.3, c.z * f * 1.1);
    }
  }

  select(slot) {
    this.selected = slot;
    this.highlight();
  }

  highlight() {
    this.dirty = true;
    if (!this.model) return;
    for (const [name, g] of this.model.slots) {
      const m = g.userData.material;
      const sel = name === this.selected;
      m.emissive.set(sel ? 0xffffff : 0x000000);
      m.emissiveIntensity = sel ? 0.35 : 0;
    }
  }

  focusSlot(slot) {
    const g = this.model?.slots.get(slot);
    if (!g) return;
    const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
    this.flyTo(c);
  }

  flyTo(target) {
    const start = this.controls.target.clone();
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 450);
      const e = t * (2 - t);
      this.controls.target.lerpVectors(start, target, e);
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  resetView() {
    if (!this.model) return;
    const d = this.model.dims;
    this.flyTo(new THREE.Vector3(0, d.H * 0.38, 0));
    this.placeCamera();
  }

  // Pull the camera back on narrow (portrait) screens so the whole vehicle fits.
  placeCamera() {
    const d = this.model.dims;
    const k = Math.max(1, 1.45 / (this.camera.aspect || 1));
    this.camera.position.set(d.L * 0.95 * k, d.H * 1.9 * k, d.L * 0.95 * k);
    this.dirty = true;
  }

  slotAt(e) {
    if (!this.model) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [];
    for (const g of this.model.slots.values()) if (g.visible) targets.push(...g.children);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return hit?.object.userData.slot || null;
  }

  pick(e) {
    const s = this.slotAt(e);
    this.select(s);
    this.onSelect?.(s);
  }

  label(slot) {
    return this.model?.slots.get(slot)?.userData.label || slot;
  }

  resize() {
    this.dirty = true;
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const t = (performance.now() - this.t0) / 1000;
    const moving = this.controls.update();
    let blinking = false;
    if (this.model) {
      const pulse = (Math.sin(t * 7) + 1) / 2; // ~1.1 Hz
      for (const [name, g] of this.model.slots) {
        if (!g.userData.blink || !g.visible) continue;
        blinking = true;
        const m = g.userData.material;
        m.color.copy(g.userData.baseColor).lerp(new THREE.Color(0x2a0000), 1 - pulse);
        if (name !== this.selected) {
          m.emissive.set(0xff2020);
          m.emissiveIntensity = pulse * 0.9;
        }
      }
    }
    // Render only when something changes (saves battery on the phone).
    const blinkDue = blinking && t - (this.lastBlink || 0) > 0.05; // ~20 fps for blinking
    if (moving || blinkDue || this.dirty) {
      if (blinkDue) this.lastBlink = t;
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }
}
