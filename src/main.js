import { openHoldMenu } from './ui/holdMenu.js';
import './styles.css';
import { db } from './data/db.js';
import { currentVehicleId, loadVehicleState } from './data/repo.js';
import { LEVELS } from './data/health.js';
import { Viewer } from './scene/viewer.js';
import { renderHealth, renderLog } from './ui/views.js';
import { renderPart, renderSlot } from './ui/partPanel.js';
import { renderObd } from './ui/obdView.js';
import { renderSpecs } from './ui/specsView.js';
import { renderInspect } from './ui/inspectView.js';
import { renderGarage, openOdometer, openVehicleWizard } from './ui/garageView.js';
import { esc, fmtMi, $ } from './ui/util.js';
import { initSync } from './ui/syncView.js';

const TABS = [
  ['health', 'Health', '◉'],
  ['inspect', 'Inspect', '✓'],
  ['log', 'Log', '☰'],
  ['obd', 'OBD', '⚡'],
  ['specs', 'Specs', '⚙'],
  ['garage', 'Garage', '⌂'],
];

const app = {
  st: null,
  tab: 'health',
  partId: null,
  slot: null,
  viewer: null,

  async loadVehicle(id) {
    this.st = await loadVehicleState(id);
    this.viewer.setVehicle(this.st.vehicle.options, this.st.vehicle.bodyColor, this.st.vehicle.id);
    this.viewer.applyHealth(this.st.slotHealth);
    this.renderHeader();
    this.showTab('health');
  },

  async refresh({ keepPanel = false } = {}) {
    if (!this.st) return;
    const prevOpts = JSON.stringify(this.st.vehicle.options) + this.st.vehicle.bodyColor;
    this.st = await loadVehicleState(this.st.vehicle.id);
    if (JSON.stringify(this.st.vehicle.options) + this.st.vehicle.bodyColor !== prevOpts) {
      this.viewer.setVehicle(this.st.vehicle.options, this.st.vehicle.bodyColor, this.st.vehicle.id);
    }
    this.viewer.applyHealth(this.st.slotHealth);
    this.renderHeader();
    // Don't redraw the OBD tab on every live alert, it updates itself.
    if (keepPanel && this.tab === 'obd') return;
    this.renderPanel();
  },

  showTab(tab) {
    this.tab = tab;
    if (tab !== 'part' && tab !== 'slot') { this.partId = null; this.slot = null; this.viewer.select(null); }
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab || (tab === 'part' || tab === 'slot') && b.dataset.tab === 'health'));
    this.renderPanel();
    $('#panel').scrollTop = 0;
  },

  openPart(id) {
    const p = this.st.parts.find((x) => x.id === id);
    if (!p) return;
    this.partId = id;
    this.tab = 'part';
    const slot = this.viewer.model?.slots.has(p.slot) ? p.slot : p.slot === 'tires' ? 'tire_FL' : null;
    this.viewer.select(slot);
    if (slot) this.viewer.focusSlot(slot);
    this.renderPanel();
    $('#panel').scrollTop = 0;
    document.body.classList.add('panel-focus');
  },

  openSlot(slot) {
    this.slot = slot;
    this.tab = 'slot';
    this.renderPanel();
    $('#panel').scrollTop = 0;
  },

  renderPanel() {
    const el = $('#panel-body');
    el.className = `panel-body ${this.tab}-view`;
    el.onclick = null;
    el.oninput = null;
    switch (this.tab) {
      case 'part': return renderPart(this, el, this.partId);
      case 'slot': return renderSlot(this, el, this.slot);
      case 'inspect': return renderInspect(this, el);
      case 'log': return renderLog(this, el);
      case 'obd': return renderObd(this, el);
      case 'specs': return renderSpecs(this, el);
      case 'garage': return renderGarage(this, el);
      default: return renderHealth(this, el);
    }
  },

  renderHeader() {
    const v = this.st.vehicle;
    $('#veh-name').textContent = v.name;
    $('#veh-sub').textContent = [v.engine, v.transmission].filter(Boolean).join(' · ');
    $('#odo').textContent = fmtMi(v.odometer);
    const blinking = this.st.parts.filter((p) => this.st.health.get(p.id).blink).length;
    $('#alert-count').textContent = blinking ? `${blinking} overdue` : '';
    $('#alert-count').hidden = !blinking;
  },
};

function shell() {
  document.querySelector('#app').innerHTML = `
  <header class="top">
    <button class="veh" id="veh-btn" title="Switch vehicle"><span id="veh-name">…</span><span id="veh-sub" class="muted small"></span></button>
    <span class="grow"></span>
    <button class="badge-red blink-soft" id="alert-count" hidden></button>
    <button class="sync-ind" id="sync-ind" hidden title="Sync"></button>
    <button class="odo" id="odo-btn" title="Update odometer"><span class="muted small">ODO</span> <b id="odo">—</b></button>
  </header>
  <main class="layout">
    <section id="stage" class="stage">
      <div class="stage-tools">
        <label class="tgl"><input type="checkbox" id="xray" checked> X-ray</label>
        <label class="tgl"><input type="checkbox" id="showbody" checked> Body</label>
        <label class="slider">Explode <input type="range" id="explode" min="0" max="1" step="0.01" value="0"></label>
        <button class="icon-btn" id="reset" title="Reset view">⟲</button>
        <button class="icon-btn only-mobile" id="expand" title="Bigger model">⤢</button>
        <button class="icon-btn" id="minimize" title="Shrink the model to a small window">▁</button>
      </div>
      <div class="mini-ctl"><button class="icon-btn" data-stage="full" title="Full size">⤢</button><button class="icon-btn" data-stage="hidden" title="Hide model">✕</button></div>
      <div class="legend">${['green', 'yellow', 'orange', 'red', 'unknown'].map((l) => `<span><i class="dot lv-${l} ${l === 'red' ? 'blink' : ''}"></i>${LEVELS[l].label}</span>`).join('')}</div>
      <div class="tooltip" id="tip" hidden></div>
    </section>
    <button class="show-model" id="show-model" title="Show the 3D model">▣ 3D</button>
    <aside id="panel" class="panel">
      <nav class="tabs">${TABS.map(([k, label, ic]) => `<button data-tab="${k}"><span class="ic">${ic}</span>${label}</button>`).join('')}</nav>
      <div id="panel-body" class="panel-body"></div>
    </aside>
  </main>`;
}

async function boot() {
  shell();
  try { await navigator.storage?.persist?.(); } catch {}
  const tip = $('#tip');
  app.viewer = new Viewer($('#stage'), {
    onHold: (slot, x, y) => openHoldMenu(app, slot, x, y),
    onSelect: (slot) => {
      if (!slot) return app.tab === 'part' || app.tab === 'slot' ? app.showTab('health') : null;
      const sh = app.st.slotHealth.get(slot);
      if (sh?.parts.length === 1) app.openPart(sh.parts[0].id);
      else app.openSlot(slot);
    },
    onHover: (slot, e) => {
      if (!slot || !app.st) { tip.hidden = true; return; }
      const sh = app.st.slotHealth.get(slot);
      const r = $('#stage').getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${e.clientX - r.left + 14}px`;
      tip.style.top = `${e.clientY - r.top + 10}px`;
      tip.innerHTML = `<b>${esc(app.viewer.label(slot))}</b><br><span class="lv-txt-${sh?.level}">${LEVELS[sh?.level || 'unknown'].label}</span> · ${sh?.parts.length || 0} part${sh?.parts.length === 1 ? '' : 's'}`;
    },
  });
  $('#xray').onchange = (e) => app.viewer.setXray(e.target.checked);
  $('#showbody').onchange = (e) => app.viewer.setBodyVisible(e.target.checked);
  $('#explode').oninput = (e) => app.viewer.setExplode(+e.target.value);
  $('#reset').onclick = () => app.viewer.resetView();
  $('#expand').onclick = () => document.body.classList.toggle('stage-big');
  // 3D model size: full, mini (floating window bottom-right) or hidden. Remembered on this device.
  const setStage = (mode) => {
    document.body.classList.toggle('stage-mini', mode === 'mini');
    document.body.classList.toggle('stage-hidden', mode === 'hidden');
    if (mode !== 'full') document.body.classList.remove('stage-big');
    try { localStorage.setItem('stageMode', mode); } catch {}
    requestAnimationFrame(() => app.viewer?.resize?.());
  };
  $('#minimize').onclick = () => setStage('mini');
  document.querySelector('.mini-ctl').onclick = (e) => { const b = e.target.closest('[data-stage]'); if (b) setStage(b.dataset.stage); };
  $('#show-model').onclick = () => setStage('mini');
  let savedStage = 'full';
  try { savedStage = localStorage.getItem('stageMode') || 'full'; } catch {}
  setStage(savedStage);
  $('#odo-btn').onclick = () => app.st && openOdometer(app);
  $('#veh-btn').onclick = () => app.st && app.showTab('garage');
  $('#alert-count').onclick = () => { app.healthFilter = 'red'; app.showTab('health'); };
  document.querySelector('.tabs').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) app.showTab(b.dataset.tab);
  };

  initSync();
  const id = await currentVehicleId();
  if (id) await app.loadVehicle(id);
  else openVehicleWizard(app, { first: true });

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.__app = app; // handy for debugging
window.__db = db;
boot();
