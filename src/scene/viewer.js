import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildVehicle } from './carModel.js';
import { loadModelScene, fitCustomModel } from './customModel.js';
import { LEVELS } from '../data/health.js';

// 3D viewer: orbit/zoom, tap to select a part slot, health colors,
// blinking for red, x-ray body and exploded view.
export class Viewer {
  constructor(container, { onSelect, onHover, onHold, mini = false } = {}) {
    this.container = container;
    this.mini = mini; // part location view: no picking, no ground, can look from below
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onHold = onHold;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !mini;
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
    this.controls.maxPolarAngle = mini ? Math.PI : Math.PI * 0.95;
    if (mini) this.controls.minDistance = 0.25;

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 7, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
    if (mini) { // light the underside too, for the Under view
      const below = new THREE.DirectionalLight(0xffffff, 1.4);
      below.position.set(1, -6, 2);
      this.scene.add(below);
    }
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    if (!mini) this.scene.add(ground);
    const grid = new THREE.PolarGridHelper(6, 12, 6, 48, 0x3b4252, 0x2a2f3a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    if (!mini) this.scene.add(grid);
    this.labelGroup = new THREE.Group();
    this.scene.add(this.labelGroup);
    this.focus = null; // Set of slots shown solid in the location view; all others ghosted

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
    // Tap selects a part. Press and hold (about 0.6 s, no drag) opens the check menu.
    const HOLD_MS = 600;
    const cancelHold = () => { clearTimeout(this.holdTimer); this.holdTimer = null; this.hideRing(); };
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, held: false };
      cancelHold();
      const s = this.slotAt(e);
      if (!s || !this.onHold) return;
      this.showRing(e.clientX, e.clientY);
      this.holdTimer = setTimeout(() => {
        if (!down) return;
        down.held = true;
        this.hideRing();
        navigator.vibrate?.(15);
        this.onHold(s, e.clientX, e.clientY);
      }, HOLD_MS);
    });
    el.addEventListener('pointerup', (e) => {
      cancelHold();
      if (down && !down.held && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e);
      down = null;
    });
    el.addEventListener('pointercancel', () => { cancelHold(); down = null; });
    el.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 6) cancelHold(); });
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

  setVehicle(options, bodyColor, vehicle) {
    if (this.model) this.scene.remove(this.model.root);
    this.customModel = false;
    this.modelKind = null;
    this.model = buildVehicle(options, bodyColor);
    const token = (this.buildToken = (this.buildToken || 0) + 1);
    if (vehicle?.id != null) {
      loadModelScene(vehicle).then((m) => { if (m && token === this.buildToken) this.useCustomModel(m.scene, bodyColor, m.kind); })
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
  useCustomModel(scene, bodyColor, kind = 'custom') {
    const m = this.model;
    const fit = fitCustomModel(scene, m.dims, bodyColor);
    for (const c of [...m.body.children]) c.visible = false;
    m.body.add(fit.group);
    fit.group.scale.z = -1; // undo the root's mirror so the model isn't flipped
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
    this.modelKind = kind;
    this.setXray(this.xray);
    this.setExplode(this.explode);
    this.applyHealth(this.slotHealth);
    this.onModelLoaded?.();
  }

  applyHealth(slotHealth) {
    this.dirty = true;
    this.slotHealth = slotHealth || new Map();
    if (!this.model) return;
    const f = this.focus;
    for (const [name, g] of this.model.slots) {
      const h = this.slotHealth.get(name);
      const m = g.userData.material;
      if (f && !f.has(name)) {
        // Ghost: faint, see-through, never blinks.
        m.color.set(0x8a96a8);
        if (!m.transparent) m.needsUpdate = true; // shader has an opaque path
        m.transparent = true; m.opacity = 0.06; m.depthWrite = false;
        g.userData.baseColor = m.color.clone();
        g.userData.blink = false;
        continue;
      }
      const level = f ? this.focusLevel?.level || h?.level : h?.level;
      // A part with no data yet still has to stand out from the grey ghosts.
      const color = f && (!level || level === 'unknown') ? '#4f8cff' : LEVELS[level || 'unknown'].color;
      m.color.set(color);
      if (m.transparent) { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; }
      g.userData.baseColor = new THREE.Color(color);
      g.userData.blink = f ? !!this.focusLevel?.blink : !!h?.blink;
    }
    this.applyVisibility(); // only parts that exist on this vehicle
    this.highlight();
  }

  setXray(on) {
    this.dirty = true;
    this.xray = on;
    if (!this.model) return;
    const { bodyMat, glassMat } = this.model.body.userData;
    const faint = this.focus ? 0.25 : 1; // location view: body barely there
    bodyMat.opacity = on ? 0.13 * faint : 0.96;
    bodyMat.depthWrite = !on;
    glassMat.opacity = on ? 0.08 * faint : 0.35;
    for (const x of this.model.body.userData.custom || []) {
      x.m.transparent = on ? true : x.transparent;
      x.m.opacity = on ? Math.min(x.opacity, 1) * 0.12 * faint : x.opacity;
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
    const solid = !this.focus && this.customModel && !this.xray && this.model.body.visible;
    for (const [name, g] of this.model.slots) {
      const has = !!this.slotHealth.get(name);
      const custom = !!g.userData.custom;
      g.visible = has && (!solid || custom || g.children.some((c) => c.userData.proxy));
      // In solid view with the user's model, only its own meshes and the tap targets show.
      for (const c of g.children) c.visible = !(solid && !custom && !c.userData.proxy);
    }
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
      const sel = this.focus ? this.focus.has(name) : name === this.selected;
      if (this.focus && sel) { m.emissive.copy(m.color); m.emissiveIntensity = 0.55; continue; } // glow in its own color
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
    // Brake tap targets first, so a press on the brake isn't taken by the tire in front.
    const proxies = [];
    for (const g of this.model.slots.values()) if (g.visible) for (const c of g.children) if (c.userData.proxy) proxies.push(c);
    const ph = this.raycaster.intersectObjects(proxies, false)[0];
    if (ph) return ph.object.userData.slot;
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    return hit?.object.userData.slot || null;
  }

  pick(e) {
    if (this.mini) return;
    const s = this.slotAt(e);
    this.select(s);
    this.onSelect?.(s);
  }

  // Small filling ring under the finger while a press-and-hold is counting.
  showRing(x, y) {
    this.hideRing();
    const r = document.createElement('div');
    r.className = 'hold-ring';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    this.ringEl = r;
  }
  hideRing() {
    this.ringEl?.remove();
    this.ringEl = null;
  }


  // ---------- Part location view ----------
  // Show only `slots` solid (colored by the part's own level, blinking if it's
  // bad); everything else is ghosted. Tags (cylinder numbers etc.) for those
  // slots are drawn on top.
  setFocus(slots, level) {
    this.focus = slots ? new Set(slots) : null;
    this.focusLevel = level || null;
    this.applyHealth(this.slotHealth);
    this.setXray(true);
    for (const c of [...this.labelGroup.children]) { this.labelGroup.remove(c); c.material.map?.dispose(); c.material.dispose(); }
    if (!this.focus || !this.model) return;
    this.model.root.updateMatrixWorld(true);
    for (const l of this.model.labels || []) if (this.focus.has(l.slot)) this.labelGroup.add(textSprite(l.text, this.model.root.localToWorld(l.pos.clone())));
    // Small parts (sensors, seals) get a ring around them so they can be found.
    const fb = this.focusBox();
    if (!fb.isEmpty()) {
      const r = fb.getSize(new THREE.Vector3()).length() / 2;
      if (r < 0.12) this.labelGroup.add(ringSprite(fb.getCenter(new THREE.Vector3()), Math.max(0.09, r * 2.6)));
    }
    const d = this.model.dims;
    this.labelGroup.add(textSprite('FRONT ▸', new THREE.Vector3(d.L / 2 + 0.3, d.ride + 0.3, 0), '#94a3b8'));
  }

  // Box around the focused shapes (tap targets left out).
  focusBox() {
    const box = new THREE.Box3();
    if (!this.model || !this.focus) return box;
    this.model.root.updateMatrixWorld(true);
    for (const name of this.focus) {
      const g = this.model.slots.get(name);
      if (!g) continue;
      for (const c of g.children) if (!c.userData.proxy) box.expandByObject(c);
    }
    return box;
  }

  // Aim the camera at the focused part. mode: 'auto' (3/4), 'top', 'side', 'under'.
  viewFocus(mode = 'auto', animate = true) {
    const box = this.focusBox();
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.1, box.getSize(new THREE.Vector3()).length() / 2);
    const side = c.z > 0.05 ? 1 : -1; // look from the side the part is on (driver side if centered)
    const dir = {
      auto: new THREE.Vector3(0.8, 0.75, side * 0.9),
      top: new THREE.Vector3(-0.15, 1, 0),
      side: new THREE.Vector3(0, 0.12, side),
      under: new THREE.Vector3(0.15, -1, 0),
    }[mode] || new THREE.Vector3(0.8, 0.75, side * 0.9);
    const k = Math.max(1, 1.3 / (this.camera.aspect || 1));
    const dist = Math.max(1.3, r * 3.4 + 0.8) * k;
    const pos = c.clone().add(dir.normalize().multiplyScalar(dist));
    this.view = mode;
    if (!animate) { this.controls.target.copy(c); this.camera.position.copy(pos); this.dirty = true; return; }
    const t0 = performance.now(), sT = this.controls.target.clone(), sP = this.camera.position.clone();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 500), e = t * (2 - t);
      this.controls.target.lerpVectors(sT, c, e);
      this.camera.position.lerpVectors(sP, pos, e);
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  // Where the focused part sits, in words (left = driver side on a US car).
  focusWhere() {
    const box = this.focusBox();
    if (box.isEmpty() || !this.model) return '';
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = this.model.dims;
    const along = c.x > d.wb / 2 - 0.95 ? 'Front' : c.x < -d.wb / 2 + 0.35 ? 'Rear' : 'Middle';
    const both = box.min.z < -0.15 && box.max.z > 0.15 && s.z > 0.4;
    // World -z is the car's left (driver side on a US car).
    const lr = both ? 'both sides' : c.z < -0.08 ? 'left (driver) side' : c.z > 0.08 ? 'right (passenger) side' : 'center';
    const low = c.y < d.ride + 0.3 ? ', reach from underneath' : '';
    return `${along}, ${lr}${low}`;
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
    if (!this.container.isConnected) return; // location view parked off-page
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

// Camera-facing text tag drawn over everything.
function textSprite(text, pos, color = '#ffffff') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fs = 44;
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w; c.height = fs + 22;
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(15,18,22,0.78)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, c.height, 14); ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = 0.055;
  sp.scale.set((h * w) / c.height, h, 1);
  sp.position.copy(pos);
  sp.renderOrder = 10;
  return sp;
}

// Hollow circle drawn over everything, marks where a small part is.
function ringSprite(pos, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#ffd400';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size, size, 1);
  sp.position.copy(pos);
  sp.renderOrder = 9;
  return sp;
}
