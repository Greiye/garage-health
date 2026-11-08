import { db } from '../data/db.js';
import { SYSTEMS } from '../data/templates.js';
import { LEVELS, worstLevel } from '../data/health.js';
import { deleteService } from '../data/repo.js';
import { esc, fmtMi, fmtDate, fmtMoney, confirmDialog } from './util.js';
import { partRow, chip, dot, thumb, openAttachment } from './partPanel.js';
import { openServiceForm } from './serviceForm.js';
import { openRotation } from './rotation.js';
import { openBaseline } from './baseline.js';
import { exportServicesCsv } from './csvExport.js';
import { renderSchedule } from './scheduleView.js';

// ---------- Health tab: what needs attention, then every system ----------
const healthSeg = (app) => `<div class="seg wide">${[['parts', 'Parts health'], ['schedule', 'Maintenance schedule']].map(([k, l]) => `<button class="seg-b ${(app.healthView || 'parts') === k ? 'on' : ''}" data-hview="${k}">${l}</button>`).join('')}</div>`;

export function renderHealth(app, el) {
  if (app.healthView === 'schedule') return renderSchedule(app, el, healthSeg(app));
  const { st } = app;
  const parts = st.parts;
  const rank = (p) => st.health.get(p.id).frac ?? -1;
  const attention = parts.filter((p) => ['red', 'orange'].includes(st.health.get(p.id).level)).sort((a, b) => rank(b) - rank(a));
  const unknown = parts.filter((p) => st.health.get(p.id).level === 'unknown' && (p.im || p.mo || p.age || p.inspect));
  const counts = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, 0]));
  for (const p of parts) counts[st.health.get(p.id).level]++;
  const filter = app.healthFilter || '';

  el.innerHTML = `${healthSeg(app)}
    <div class="summary">${['red', 'orange', 'yellow', 'green', 'unknown'].map((l) => `<button class="sum lv-${l} ${filter === l ? 'on' : ''}" data-filter="${l}"><b>${counts[l]}</b><span>${LEVELS[l].label}</span></button>`).join('')}</div>
    <div class="actions"><button class="btn primary" data-act="log">Log service</button><button class="btn" data-act="rotate">Rotate tires</button></div>
    ${filter ? `<section><div class="sec-head"><h3>${LEVELS[filter].label}</h3><button class="btn small" data-filter="">Clear</button></div><ul class="list">${parts.filter((p) => st.health.get(p.id).level === filter).sort((a, b) => rank(b) - rank(a)).map((p) => partRow(app, p)).join('') || '<li class="muted">None</li>'}</ul></section>` : `
    <section><h3>Needs attention</h3>${attention.length ? `<ul class="list">${attention.map((p) => partRow(app, p)).join('')}</ul>` : '<p class="muted small">Nothing overdue or due soon.</p>'}</section>
    ${unknown.length ? `<section class="callout"><b>${unknown.length} parts have no history yet.</b> Open one and use "Done today", "Log service" or "Add details" with the last date and mileage you know. Grey parts on the model are the ones with no data.<div class="row end"><button class="btn small primary" data-act="baseline">Enter known history</button></div></section>` : ''}
    ${SYSTEMS.map((sys) => {
      const ps = parts.filter((p) => p.system === sys);
      if (!ps.length) return '';
      const lv = worstLevel(ps.map((p) => st.health.get(p.id).level));
      const open = app.openSystems?.has(sys);
      return `<details class="sys" data-sys="${esc(sys)}" ${open ? 'open' : ''}><summary>${dot(lv, ps.some((p) => st.health.get(p.id).blink))}<span class="grow">${esc(sys)}</span><span class="muted small">${ps.length}</span></summary><ul class="list">${ps.sort((a, b) => rank(b) - rank(a)).map((p) => partRow(app, p)).join('')}</ul></details>`;
    }).join('')}`}`;

  el.onclick = (e) => {
    const hv = e.target.closest('[data-hview]');
    if (hv) { app.healthView = hv.dataset.hview; return renderHealth(app, el); }
    const f = e.target.closest('[data-filter]');
    if (f) { app.healthFilter = f.dataset.filter === filter ? '' : f.dataset.filter; return renderHealth(app, el); }
    const pr = e.target.closest('[data-part]');
    if (pr) return app.openPart(+pr.dataset.part);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'log') openServiceForm(app);
    if (a === 'rotate') openRotation(app);
    if (a === 'baseline') openBaseline(app);
  };
  el.querySelectorAll('details.sys').forEach((d) => d.addEventListener('toggle', () => {
    app.openSystems ||= new Set();
    d.open ? app.openSystems.add(d.dataset.sys) : app.openSystems.delete(d.dataset.sys);
  }));
}

// ---------- Log tab ----------
export async function renderLog(app, el) {
  const { st } = app;
  const q = (app.logQuery || '').toLowerCase();
  const services = st.services.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : (b.miles ?? 0) - (a.miles ?? 0)));
  const pname = (id) => st.allParts.find((p) => p.id === id)?.name || '?';
  const shown = services.filter((s) => !q || `${s.title} ${s.notes} ${s.shop} ${(s.partIds || []).map(pname).join(' ')}`.toLowerCase().includes(q));
  const atts = await db.attachments.where({ vehicleId: st.vehicle.id }).toArray();
  const byYear = {};
  for (const s of services) if (s.cost && s.date) byYear[s.date.slice(0, 4)] = (byYear[s.date.slice(0, 4)] || 0) + s.cost;
  const total = Object.values(byYear).reduce((a, b) => a + b, 0);

  el.innerHTML = `
    <div class="actions"><button class="btn primary" data-act="log">Log service</button><button class="btn" data-act="csv">Export CSV</button><input type="search" class="grow" placeholder="Search log…" value="${esc(app.logQuery || '')}" data-q></div>
    ${total ? `<div class="spend"><span>Total spent <b>${fmtMoney(total)}</b></span>${Object.entries(byYear).sort().reverse().slice(0, 5).map(([y, v]) => `<span>${y}: ${fmtMoney(v)}</span>`).join('')}</div>` : ''}
    ${shown.length ? `<ul class="timeline">${shown.map((s) => `<li data-service="${s.id}">
      <div class="t-date">${fmtDate(s.date)}<br><span class="muted small">${fmtMi(s.miles)}</span></div>
      <div class="grow"><div class="row between"><b>${esc(s.title)}</b><span class="muted small">${s.cost ? fmtMoney(s.cost) : ''}</span></div>
      <div class="muted small">${esc(s.type || '')}${s.shop ? ` · ${esc(s.shop)}` : ''}${s.hours ? ` · ${s.hours} h` : ''}</div>
      <div class="tags">${(s.partIds || []).map((id) => `<span class="tag" data-part="${id}">${esc(pname(id))}</span>`).join('')}</div>
      ${s.notes ? `<div class="small pre">${esc(s.notes)}</div>` : ''}
      <div class="thumbs">${atts.filter((a) => a.serviceId === s.id).map(thumb).join('')}</div>
      <div class="row end"><button class="btn small" data-edit="${s.id}">Edit</button><button class="btn small danger" data-del="${s.id}">Delete</button></div></div></li>`).join('')}</ul>`
      : `<p class="muted">${q ? 'No matches.' : 'No services logged yet. Log your last oil change to get started.'}</p>`}`;

  el.querySelector('[data-q]').oninput = (e) => { app.logQuery = e.target.value; renderLog(app, el).then(() => { const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-att],[data-part],[data-edit],[data-del],[data-act]');
    if (!t) return;
    if (t.dataset.att) return openAttachment(+t.dataset.att);
    if (t.dataset.part) return app.openPart(+t.dataset.part);
    if (t.dataset.edit) return openServiceForm(app, { service: st.services.find((s) => s.id === +t.dataset.edit) });
    if (t.dataset.del && (await confirmDialog('Delete this service entry and its photos/receipts? Parts installed by it keep their records.', 'Delete'))) {
      await deleteService(+t.dataset.del);
      return app.refresh();
    }
    if (t.dataset.act === 'log') openServiceForm(app);
    if (t.dataset.act === 'csv') exportServicesCsv(st);
  };
}
