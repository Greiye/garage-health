import { db, todayISO } from '../data/db.js';
import { LEVELS, FLAG_SEVERITY, SOURCE_LABEL, monthsBetween } from '../data/health.js';
import { addFlag, resolveFlag, saveService, addMeasurement, ensureComponent, addWatch } from '../data/repo.js';
import { CORNER_NAME } from '../data/templates.js';
import { esc, fmtMi, fmtDate, fmtMoney, modal, num, toast, blobURL, confirmDialog } from './util.js';
import { openServiceForm, componentFieldsHTML, readComponentFields } from './serviceForm.js';
import { openRotation } from './rotation.js';
import { vehicleCatalog } from '../data/repo.js';
import { pnHTML } from './catalogView.js';

export const chip = (level, extra = '') => `<span class="chip lv-${level}">${LEVELS[level].label}${extra}</span>`;
export const dot = (level, blink) => `<span class="dot lv-${level} ${blink ? 'blink' : ''}"></span>`;

export function renderSlot(app, el, slot) {
  const sh = app.st.slotHealth.get(slot);
  if (!sh) { el.innerHTML = '<p class="muted">Nothing here.</p>'; return; }
  if (sh.parts.length === 1) return renderPart(app, el, sh.parts[0].id);
  const parts = [...sh.parts].sort((a, b) => (app.st.health.get(b.id).frac ?? -1) - (app.st.health.get(a.id).frac ?? -1));
  el.innerHTML = `<div class="panel-head"><button class="icon-btn" data-back>←</button><div><h2>${esc(app.viewer.label(slot))}</h2><div class="muted small">${parts.length} parts</div></div></div>
    <ul class="list">${parts.map((p) => partRow(app, p)).join('')}</ul>`;
  el.querySelector('[data-back]').onclick = () => app.showTab('health');
}

export function partRow(app, p) {
  const h = app.st.health.get(p.id);
  const c = app.st.component.get(p.id);
  const sub = h.reasons[0]?.text || (c?.brand ? `${c.brand} ${c.model || ''}` : 'No data yet');
  return `<li class="row-item" data-part="${p.id}">${dot(h.level, h.blink)}<div class="grow"><div>${esc(p.name)}</div><div class="muted small">${esc(sub)}</div></div>${chip(h.level)}</li>`;
}

export async function renderPart(app, el, partId) {
  const { st } = app;
  const p = st.parts.find((x) => x.id === partId);
  if (!p) return app.showTab('health');
  const h = st.health.get(p.id);
  const comp = st.component.get(p.id);
  const flags = st.flags.filter((f) => f.partId === p.id);
  const services = st.services.filter((s) => (s.partIds || []).includes(p.id)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const pastComps = st.components.filter((c) => c.removedDate && (c.partId === p.id || (c.positionHistory || []).some((x) => x.partId === p.id))).sort((a, b) => (a.removedDate < b.removedDate ? 1 : -1));
  const atts = await db.attachments.where('serviceId').anyOf(services.map((s) => s.id)).toArray();
  const compAtts = comp ? await db.attachments.where({ componentId: comp.id }).toArray() : [];
  const last = st.lastService.get(p.id);
  const odo = st.vehicle.odometer;
  const tire = p.kind === 'tire';
  const ms = p.measure;
  const meas = (comp?.measurements || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  const usedMiles = comp?.installMiles != null && odo != null ? odo - comp.installMiles : null;
  const ageYears = comp?.mfgDate ? monthsBetween(comp.mfgDate, todayISO()) / 12 : null;

  el.innerHTML = `
  <div class="panel-head"><button class="icon-btn" data-back aria-label="Back">←</button>
    <div class="grow"><h2>${esc(p.name)}</h2><div class="muted small">${esc(p.system)}${p.position ? ` · ${esc(CORNER_NAME[p.position] || p.position)}` : ''}</div></div>
    ${chip(h.level, h.blink ? ' ●' : '')}</div>

  ${h.reasons.length ? `<ul class="reasons">${h.reasons.map((r) => `<li>${dot(r.level)} ${esc(r.text)}</li>`).join('')}</ul>` : ''}
  ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ''}
  ${catalogFor(st.vehicle, p)}

  <div class="actions">
    <button class="btn primary" data-act="log">Log service</button>
    <button class="btn" data-act="replace">Replaced it</button>
    ${p.im || p.mo ? '<button class="btn" data-act="quick">Done today</button>' : ''}
    ${p.inspect ? '<button class="btn" data-act="checked">Checked OK</button>' : ''}
    ${p.inspect ? '<button class="btn" data-act="watch">Watch (couldn\'t fully check)</button>' : ''}
    ${ms ? `<button class="btn" data-act="measure">Add ${esc(ms.label.toLowerCase())}</button>` : ''}
    ${tire || p.key === 'rotation' ? '<button class="btn" data-act="rotate">Rotate tires</button>' : ''}
    <button class="btn warn" data-act="symptom">Report symptom</button>
  </div>

  ${flags.length ? `<section><h3>Active issues</h3><ul class="list">${flags.map((f) => `<li class="row-item">${dot(f.severity === 'critical' ? 'red' : f.severity === 'warn' ? 'orange' : 'yellow')}<div class="grow"><div>${esc(f.text)}</div><div class="muted small">${esc(f.source === 'user' ? 'You' : SOURCE_LABEL[f.source] || f.source.toUpperCase())} · ${fmtDate(f.createdAt?.slice(0, 10))}</div></div><button class="btn small" data-resolve="${f.id}">Resolve</button></li>`).join('')}</ul></section>` : ''}

  <section><div class="sec-head"><h3>Installed ${tire ? 'tire' : 'part'}</h3><button class="btn small" data-act="editcomp">${comp ? 'Edit' : 'Add details'}</button></div>
    ${comp ? `<dl class="kv">
      ${kv('Brand', [comp.brand, comp.model].filter(Boolean).join(' '))}
      ${kv('Part number', comp.partNumber)}
      ${tire ? kv('Size', comp.size) : ''}
      ${tire ? kv('DOT date', comp.dot ? `${comp.dot} (${fmtDate(comp.mfgDate)})` : '') : kv('Manufactured', comp.mfgDate && fmtDate(comp.mfgDate))}
      ${kv('Age', ageYears != null ? `${ageYears.toFixed(1)} years` : '')}
      ${kv('Installed', comp.installDate ? `${fmtDate(comp.installDate)}${comp.installMiles != null ? ` at ${fmtMi(comp.installMiles)}` : ''}` : '')}
      ${kv('Miles on it', usedMiles != null ? fmtMi(usedMiles) : '')}
      ${kv('Price', fmtMoney(comp.price))}
      ${kv('Bought from', comp.vendor)}
      ${kv('Warranty', [comp.warrantyMonths && `${comp.warrantyMonths} mo`, comp.warrantyMiles && fmtMi(comp.warrantyMiles)].filter(Boolean).join(' / '))}
      ${tire && comp.positionHistory?.length > 1 ? kv('Positions', comp.positionHistory.map((x) => (st.allParts.find((pp) => pp.id === x.partId)?.position || '?')).join(' → ')) : ''}
    </dl>
    ${compAtts.length ? `<div class="thumbs">${compAtts.map(thumb).join('')}</div>` : ''}
    <label class="file small-file">Add photo<input type="file" accept="image/*,application/pdf" multiple data-comp-photo></label>`
    : `<p class="muted small">No details yet. Add brand, part number, install date and mileage so this part tracks its own age and wear.</p>`}
  </section>

  ${ms ? `<section><div class="sec-head"><h3>${esc(ms.label)}</h3><span class="muted small">${ms.nominal != null ? `new ${ms.nominal} · limit ${ms.limit} ${esc(ms.unit)}` : 'Set limits in Intervals & limits'}</span></div>
    ${meas.length ? `${sparkline(meas.slice().reverse(), ms)}<table class="tbl"><tr><th>Date</th><th>Miles</th><th>${esc(ms.unit)}</th><th>Note</th></tr>${meas.map((m) => `<tr><td>${fmtDate(m.date)}</td><td>${fmtMi(m.miles)}</td><td><b>${m.value}</b></td><td>${esc(m.note || '')}</td></tr>`).join('')}</table>` : '<p class="muted small">No measurements yet.</p>'}
  </section>` : ''}

  <section><div class="sec-head"><h3>Intervals & limits</h3><button class="btn small" data-act="settings">Edit</button></div>
    <dl class="kv">
      ${kv('Replace every', [p.im && fmtMi(p.im), p.mo && `${p.mo} months`].filter(Boolean).join(' or ') || (p.inspect || p.life ? 'No fixed interval: replace when worn or leaking' : 'Condition-based'))}
      ${p.life && !(p.im || p.mo) ? kv('Typical life', `about ${[p.life.im && fmtMi(p.life.im), p.life.mo && `${Math.round(p.life.mo / 12)} years`].filter(Boolean).join(' or ')} (turns yellow, not red)`) : ''}
      ${p.inspect ? kv('Inspect every', [p.inspect.im && fmtMi(p.inspect.im), p.inspect.mo && `${p.inspect.mo} months`].filter(Boolean).join(' or ')) : ''}
      ${p.pm?.what ? kv('What to check', p.pm.what) : ''}
      ${st.checked?.get(p.id) ? kv('Last checked', `${fmtDate(st.checked.get(p.id).date)}${st.checked.get(p.id).miles != null ? ` at ${fmtMi(st.checked.get(p.id).miles)}` : ''}`) : ''}
      ${kv('Schedule', p.customInterval ? 'Your own interval' : p.pm ? `${(st.vehicle.scheduleMode || 'normal') === 'severe' ? 'Severe' : 'Normal'} schedule${p.pm.src ? ` (${p.pm.src})` : ''}` : '')}
      ${p.pm?.note ? kv('Note', p.pm.note) : ''}
      ${kv('Max age', p.age ? `${(p.age / 12).toFixed(1)} years` : '')}
      ${kv('Last service', last ? `${fmtDate(last.date)}${last.miles != null ? ` at ${fmtMi(last.miles)}` : ''}` : '')}
      ${kv('Next due', nextDue(p, last, comp))}
    </dl>
  </section>

  <section><h3>History</h3>
    ${services.length ? `<ul class="timeline">${services.map((s) => `<li data-service="${s.id}"><div class="t-date">${fmtDate(s.date)}<br><span class="muted small">${fmtMi(s.miles)}</span></div><div class="grow"><b>${esc(s.title)}</b> <span class="muted small">${esc(s.type || '')}${s.cost ? ` · ${fmtMoney(s.cost)}` : ''}</span>${s.notes ? `<div class="small">${esc(s.notes)}</div>` : ''}<div class="thumbs">${atts.filter((a) => a.serviceId === s.id).map(thumb).join('')}</div></div></li>`).join('')}</ul>` : '<p class="muted small">No services logged for this part.</p>'}
    ${pastComps.length ? `<h4>Previous ${tire ? 'tires' : 'parts'}</h4><ul class="list">${pastComps.map((c) => `<li class="row-item"><div class="grow"><div>${esc([c.brand, c.model].filter(Boolean).join(' ') || 'Unrecorded part')} ${c.partNumber ? `<span class="muted small">#${esc(c.partNumber)}</span>` : ''}</div><div class="muted small">${fmtDate(c.installDate)} → ${fmtDate(c.removedDate)}${c.installMiles != null && c.removedMiles != null ? ` · ${fmtMi(c.removedMiles - c.installMiles)} of use` : ''}</div></div></li>`).join('')}</ul>` : ''}
  </section>`;

  el.querySelector('[data-back]').onclick = () => app.showTab('health');
  el.onclick = async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    const rs = e.target.closest('[data-resolve]');
    const sv = e.target.closest('[data-service]');
    const at = e.target.closest('[data-att]');
    if (at) return openAttachment(+at.dataset.att);
    if (rs) { await resolveFlag(+rs.dataset.resolve); return app.refresh(); }
    if (a === 'log') return openServiceForm(app, { partIds: [p.id], title: p.name });
    if (a === 'replace') return openServiceForm(app, { partIds: [p.id], title: `Replaced ${p.name.toLowerCase()}`, type: 'Replacement', replace: true });
    if (a === 'quick') {
      await saveService({ vehicleId: st.vehicle.id, date: todayISO(), miles: odo, title: p.name, type: 'Maintenance', partIds: [p.id], cost: null, notes: '' });
      toast(`${p.name} marked done at ${fmtMi(odo)}`);
      return app.refresh();
    }
    if (a === 'checked') {
      await saveService({ vehicleId: st.vehicle.id, date: todayISO(), miles: odo, title: `${p.name} checked`, type: 'Inspection', partIds: [p.id], cost: null, notes: p.pm?.what ? `Checked: ${p.pm.what}` : '' });
      toast(`${p.name} checked at ${fmtMi(odo)}`);
      return app.refresh();
    }
    if (a === 'watch') return openWatch(app, p);
    if (a === 'measure') return openMeasure(app, p);
    if (a === 'rotate') return openRotation(app);
    if (a === 'symptom') return openSymptom(app, p);
    if (a === 'editcomp') return openComponentEdit(app, p, comp);
    if (a === 'settings') return openPartSettings(app, p);
    if (sv && !e.target.closest('button')) return openServiceForm(app, { service: st.services.find((s) => s.id === +sv.dataset.service) });
  };
  const cp = el.querySelector('[data-comp-photo]');
  if (cp) cp.onchange = async () => {
    for (const f of cp.files) await db.attachments.add({ vehicleId: st.vehicle.id, componentId: comp.id, kind: 'photo', name: f.name, type: f.type, size: f.size, blob: f, addedAt: new Date().toISOString() });
    toast('Photo added');
    renderPart(app, el, partId);
  };
}

const kv = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');

export function thumb(a) {
  return a.type?.startsWith('image') ? `<button class="thumb" data-att="${a.id}" title="${esc(a.kind)}"><img src="${blobURL(a)}" alt=""><span>${esc(a.kind)}</span></button>`
    : `<button class="thumb file" data-att="${a.id}" title="${esc(a.name)}">📄<span>${esc(a.kind)}</span></button>`;
}

export async function openAttachment(id) {
  const a = await db.attachments.get(id);
  const url = blobURL(a);
  if (a.type?.startsWith('image')) {
    modal(a.name || a.kind, `<img class="full" src="${url}" alt=""><div class="row end"><a class="btn" href="${url}" download="${esc(a.name)}">Download</a></div>`, { wide: true });
  } else {
    modal(a.name || a.kind, `<object class="pdf" data="${url}" type="${esc(a.type)}"><p>Preview not available.</p></object><div class="row end"><a class="btn" href="${url}" target="_blank" download="${esc(a.name)}">Open / download</a></div>`, { wide: true });
  }
}

function nextDue(p, last, comp) {
  const base = last || (comp?.installDate ? { date: comp.installDate, miles: comp.installMiles } : null);
  if (!base || (!p.im && !p.mo)) return '';
  const out = [];
  if (p.im && base.miles != null) out.push(fmtMi(base.miles + p.im));
  if (p.mo && base.date) {
    const d = new Date(base.date);
    d.setMonth(d.getMonth() + p.mo);
    out.push(fmtDate(d.toISOString().slice(0, 10)));
  }
  return out.join(' or ');
}

function sparkline(meas, ms) {
  if (meas.length < 2) return '';
  const vals = meas.map((m) => m.value);
  const lo = Math.min(...vals, ms.limit ?? Infinity), hi = Math.max(...vals, ms.nominal ?? -Infinity);
  const W = 300, H = 60, y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (W - 10) + 5},${y(v)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}">${ms.limit != null ? `<line x1="0" x2="${W}" y1="${y(ms.limit)}" y2="${y(ms.limit)}" class="limit"/>` : ''}<polyline points="${pts}"/></svg>`;
}

function openMeasure(app, p) {
  const ms = p.measure;
  modal(`Add ${ms.label.toLowerCase()}`, `<form class="form">
    <div class="grid2"><label>Value (${esc(ms.unit)})<input type="number" step="any" name="value" required inputmode="decimal" autofocus></label>
    <label>Date<input type="date" name="date" value="${todayISO()}"></label>
    <label>Odometer<input type="number" name="miles" value="${app.st.vehicle.odometer ?? ''}"></label>
    <label>Note<input name="note" placeholder="inner edge, cold, etc."></label></div>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    onSubmit: async (fd) => {
      const c = await ensureComponent(app.st.vehicle.id, p.id);
      await addMeasurement(c.id, { date: fd.get('date'), miles: num(fd.get('miles')), value: +fd.get('value'), note: fd.get('note') });
      await app.refresh();
    },
  });
}

function openSymptom(app, p) {
  modal(`Report symptom: ${p.name}`, `<form class="form">
    <label>What's happening?<input name="text" required placeholder="Clunk over bumps, weeping coolant, squeal on cold start…"></label>
    <label>Severity<select name="severity">${Object.entries(FLAG_SEVERITY).map(([k, v]) => `<option value="${k}" ${k === 'warn' ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <p class="muted small">Watch = yellow, Needs attention = orange, Critical = red and blinking. Logging a service on this part resolves it.</p>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    onSubmit: async (fd) => {
      await addFlag({ vehicleId: app.st.vehicle.id, partId: p.id, source: 'user', severity: fd.get('severity'), text: fd.get('text') });
      await app.refresh();
    },
  });
}

function openComponentEdit(app, p, comp) {
  const c = comp || {};
  modal(`${comp ? 'Edit' : 'Add'} installed ${p.kind === 'tire' ? 'tire' : 'part'}`, `<form class="form">
    ${componentFieldsHTML(p, c)}
    <div class="grid2"><label>Installed on<input type="date" name="installDate" value="${esc(c.installDate || '')}"></label>
    <label>Installed at (mi)<input type="number" name="installMiles" value="${esc(c.installMiles ?? '')}"></label></div>
    <label>Notes<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
    <p class="muted small">Use this for parts already on the car. For a new swap use "Replaced it" so the old part goes to history.</p>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    wide: true,
    onSubmit: async (fd) => {
      const data = { ...readComponentFields(fd, '', p), installDate: fd.get('installDate') || null, installMiles: num(fd.get('installMiles')), notes: fd.get('notes') };
      if (comp) await db.components.update(comp.id, { ...data, unknownOrigin: false });
      else await db.components.add({ vehicleId: app.st.vehicle.id, partId: p.id, ...data, measurements: [], positionHistory: [{ date: data.installDate, miles: data.installMiles, partId: p.id }] });
      await app.refresh();
    },
  });
}

function openPartSettings(app, p) {
  const ms = p.measure || {};
  modal(`Intervals & limits: ${p.name}`, `<form class="form">
    <label>Name<input name="name" value="${esc(p.name)}"></label>
    <div class="grid2">
      <label>Service interval (miles)<input type="number" name="im" value="${p.im || ''}" placeholder="none"></label>
      <label>Service interval (months)<input type="number" name="mo" value="${p.mo || ''}" placeholder="none"></label>
      <label>Max age (months from manufacture)<input type="number" name="age" value="${p.age || ''}" placeholder="none"></label>
      <label>Inspect every (miles)<input type="number" name="iim" value="${p.inspect?.im || ''}" placeholder="none"></label>
      <label>Inspect every (months)<input type="number" name="imo" value="${p.inspect?.mo || ''}" placeholder="none"></label>
    </div>
    ${p.pm ? `<label class="chk small"><input type="checkbox" name="usepm" ${p.customInterval ? '' : 'checked'}> Use the recommended ${(app.st.vehicle.scheduleMode || 'normal')} schedule (unticks itself if you change the numbers)</label>` : ''}
    ${p.measure ? `<div class="grid2"><label>${esc(ms.label)} when new (${esc(ms.unit)})<input type="number" step="any" name="nominal" value="${ms.nominal ?? ''}"></label>
    <label>${esc(ms.label)} limit (${esc(ms.unit)})<input type="number" step="any" name="limit" value="${ms.limit ?? ''}"></label></div>` : ''}
    <label>Notes<textarea name="notes" rows="3">${esc(p.notes || '')}</textarea></label>
    <div class="row between"><button class="btn danger" type="button" data-hide>Hide this part</button><span><button class="btn" type="button" data-close>Cancel</button> <button class="btn primary" type="submit">Save</button></span></div></form>`, {
    onMount: (root, close) => root.querySelector('[data-hide]').onclick = async () => {
      if (!(await confirmDialog(`Hide "${p.name}"? Its history is kept and you can restore it in Garage → Parts.`, 'Hide'))) return;
      await db.parts.update(p.id, { hidden: true, userHidden: true });
      close();
      await app.refresh();
      app.showTab('health');
    },
    onSubmit: async (fd) => {
      const upd = { name: fd.get('name').trim() || p.name, im: num(fd.get('im')) || 0, mo: num(fd.get('mo')) || 0, age: num(fd.get('age')) || 0, notes: fd.get('notes') };
      const ins = { im: num(fd.get('iim')) || 0, mo: num(fd.get('imo')) || 0 };
      const changed = upd.im !== (p.im || 0) || upd.mo !== (p.mo || 0) || ins.im !== (p.inspect?.im || 0) || ins.mo !== (p.inspect?.mo || 0);
      const usePm = p.pm && fd.get('usepm') && !changed;
      upd.customInterval = !usePm;
      upd.customInspect = usePm ? null : (ins.im || ins.mo ? ins : null);
      if (p.measure) upd.measure = { ...p.measure, nominal: num(fd.get('nominal')), limit: num(fd.get('limit')) };
      await db.parts.update(p.id, upd);
      await app.refresh();
    },
  });
}

// Catalog lines (fluids, filters, gaskets, part numbers) for one part.
function catalogFor(vehicle, p) {
  const items = vehicleCatalog(vehicle).filter((c) => c.parts.includes(p.key));
  if (!items.length) return '';
  return `<details class="sys"><summary><span class="grow">Parts, fluids & gaskets</span><span class="muted small">${items.length}</span></summary><ul class="list compact">${items.map((c) => `<li class="row-item"><div class="grow"><div>${esc(c.name)}${c.qty > 1 ? ` ×${c.qty}` : ''}</div>${c.spec ? `<div class="small">${esc(c.spec)}</div>` : ''}${c.capacity ? `<div class="small muted">Capacity: ${esc(c.capacity)}</div>` : ''}${c.pns?.length ? `<div class="pns">${pnHTML(c.pns)}</div>` : ''}${c.fab ? `<div class="small muted">Make it: ${esc(c.fab)}</div>` : ''}</div></li>`).join('')}</ul></details>`;
}

function openWatch(app, p) {
  modal("Couldn't fully check", `<form class="form"><p class="small muted">${esc(p.name)} turns yellow (Watch) until you do a full Checked OK or replace it. It doesn't reset the inspection schedule.</p>
    <label>What's left to check, or the tool you need<input name="note" placeholder="e.g. need a borescope" autofocus></label>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Mark as Watch</button></div></form>`, {
    onSubmit: async (fd) => {
      await addWatch(app.st.vehicle.id, p.id, String(fd.get('note') || '').trim());
      toast(`${p.name} marked Watch`);
      await app.refresh();
    },
  });
}
