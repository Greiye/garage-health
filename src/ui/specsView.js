import { db } from '../data/db.js';
import { esc, modal } from './util.js';
import { renderCatalog } from './catalogView.js';

const modeBar = (m) => `<div class="seg wide">${[['specs', 'Specs'], ['catalog', 'Parts catalog']].map(([k, l]) => `<button class="seg-b ${m === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>`;

// Per-vehicle spec sheet: fluids, capacities, torque values, part numbers.
export function renderSpecs(app, el) {
  const mode = app.specMode || 'specs';
  if (mode === 'catalog') return renderCatalog(app, el, { header: modeBar(mode) });
  const v = app.st.vehicle;
  const specs = v.specs || [];
  const groups = [...new Set(specs.map((s) => s.group))];
  el.innerHTML = `${modeBar(mode)}
    <div class="actions"><button class="btn primary" data-act="add">Add spec</button></div>
    ${specs.some((s) => s.verify) ? '<p class="callout small">Values marked <span class="verify">verify</span> are starting points. Check them against your service manual, the oil cap or the door placard, then edit to clear the mark.</p>' : ''}
    ${groups.map((g) => `<section><h3>${esc(g)}</h3><dl class="kv specs">${specs.map((s, i) => (s.group === g ? `<dt>${esc(s.label)}</dt><dd data-i="${i}">${esc(s.value) || '<span class="muted">tap to set</span>'} ${s.verify ? '<span class="verify">verify</span>' : ''}</dd>` : '')).join('')}</dl></section>`).join('') || '<p class="muted">No specs yet.</p>'}`;
  el.onclick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { app.specMode = m.dataset.mode; return renderSpecs(app, el); }
    const d = e.target.closest('[data-i]');
    if (d) return edit(app, +d.dataset.i);
    if (e.target.closest('[data-act=add]')) edit(app, -1);
  };
}

function edit(app, i) {
  const v = app.st.vehicle;
  const specs = [...(v.specs || [])];
  const s = specs[i] || { group: 'Fluids', label: '', value: '' };
  modal(i < 0 ? 'Add spec' : s.label, `<form class="form">
    <div class="grid2"><label>Group<input name="group" value="${esc(s.group)}" list="spec-groups"></label><label>Name<input name="label" value="${esc(s.label)}" required></label></div>
    <datalist id="spec-groups">${['Fluids', 'Torque', 'Ignition', 'Tires', 'Part numbers', 'OBD', 'Other'].map((g) => `<option>${g}</option>`).join('')}</datalist>
    <label>Value<input name="value" value="${esc(s.value)}"></label>
    <label class="chk"><input type="checkbox" name="verify" ${s.verify ? 'checked' : ''}> Needs verification</label>
    <div class="row between">${i >= 0 ? '<button class="btn danger" type="button" data-del>Delete</button>' : '<span></span>'}<span><button class="btn" type="button" data-close>Cancel</button> <button class="btn primary" type="submit">Save</button></span></div></form>`, {
    onMount: (root, close) => {
      const d = root.querySelector('[data-del]');
      if (d) d.onclick = async () => { specs.splice(i, 1); await db.vehicles.update(v.id, { specs }); close(); app.refresh(); };
    },
    onSubmit: async (fd) => {
      const row = { group: fd.get('group').trim() || 'Other', label: fd.get('label').trim(), value: fd.get('value').trim(), verify: !!fd.get('verify') };
      if (i < 0) specs.push(row); else specs[i] = row;
      await db.vehicles.update(v.id, { specs });
      await app.refresh();
    },
  });
}
