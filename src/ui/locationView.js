import { Viewer } from '../scene/viewer.js';
import { VIRTUAL_SLOTS } from '../data/repo.js';

// Small 3D view on the part page: the vehicle with everything ghosted except
// this part, which is drawn in its health color (blinking if it's bad) with the
// camera zoomed to it. One view is kept and moved between part pages, so the
// phone only holds one extra WebGL context.
let loc = null;

function ensure(app) {
  if (loc) return loc;
  const el = document.createElement('div');
  el.className = 'loc-view';
  el.innerHTML = `<div class="loc-stage"></div>
    <div class="loc-tools">${[['auto', '3D'], ['top', 'Top'], ['side', 'Side'], ['under', 'Under']].map(([k, l]) => `<button class="seg" data-view="${k}">${l}</button>`).join('')}</div>`;
  const viewer = new Viewer(el.querySelector('.loc-stage'), { mini: true });
  el.querySelector('.loc-tools').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    viewer.viewFocus(b.dataset.view);
    mark(el, b.dataset.view);
  };
  loc = { el, viewer, key: null };
  return loc;
}

const mark = (el, mode) => el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));

// Slots that show this part on the model.
export function partSlots(app, p) {
  const out = [];
  for (const s of [p.slot, ...(p.also || [])]) for (const x of VIRTUAL_SLOTS[s] || [s]) out.push(x);
  return out;
}

// Puts the location view into `host` (a section on the part page). Hides the
// section if the part has no shape on this vehicle's model.
export function mountLocation(app, host, p) {
  const section = host.closest('section');
  const l = ensure(app);
  const v = app.st.vehicle;
  const key = `${v.id}|${JSON.stringify(v.options)}|${v.bodyColor}`;
  if (l.key !== key) {
    l.viewer.setVehicle(v.options, v.bodyColor, v);
    l.key = key;
  }
  const slots = partSlots(app, p).filter((s) => l.viewer.model?.slots.has(s));
  if (!slots.length) { section.hidden = true; return; }
  host.replaceChildren(l.el);
  l.viewer.resize();
  l.viewer.applyHealth(app.st.slotHealth);
  const h = app.st.health.get(p.id);
  l.viewer.setFocus(slots, { level: h?.level, blink: h?.blink });
  // Re-aim after the user's own model (placeholder) finishes loading too.
  const aim = (animate) => {
    l.viewer.viewFocus(l.partId === p.id && l.viewer.view ? l.viewer.view : 'auto', animate);
    mark(l.el, l.viewer.view);
    const cap = section.querySelector('[data-loc-cap]');
    if (cap) cap.textContent = l.viewer.focusWhere();
  };
  aim(l.partId === p.id);
  l.partId = p.id;
  l.viewer.onModelLoaded = () => { l.viewer.setFocus(slots, { level: h?.level, blink: h?.blink }); };
}

export const locationSection = () => `<section class="loc"><div class="sec-head"><h3>Location</h3><span class="muted small" data-loc-cap></span></div><div data-loc-host></div>
  <p class="muted small loc-note">Simplified shapes. Drag to turn, pinch to zoom.</p></section>`;
