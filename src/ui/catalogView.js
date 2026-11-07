import { CATEGORIES } from '../data/catalog.js';
import { vehicleCatalog, saveCatalogItem } from '../data/repo.js';
import { esc, modal, download } from './util.js';

// Parts catalog: everything you can buy or make, with specs and part numbers.
export function renderCatalog(app, el, { header = '' } = {}) {
  const { st } = app;
  const keys = new Set(st.parts.map((p) => p.key));
  const all = vehicleCatalog(st.vehicle).filter((c) => c.custom || c.parts.some((k) => keys.has(k)));
  const q = (app.catQuery || '').toLowerCase();
  const cat = app.catFilter || '';
  const shown = all.filter((c) => (!cat || c.cat === cat) && (!q || `${c.name} ${c.spec || ''} ${c.note || ''} ${(c.pns || []).map((p) => `${p.brand} ${p.pn}`).join(' ')}`.toLowerCase().includes(q)));
  const unverified = all.filter((c) => (c.pns || []).some((p) => !p.verified)).length;

  el.innerHTML = `${header}
    <div class="actions"><input type="search" class="grow" placeholder="Search parts, numbers, specs…" value="${esc(app.catQuery || '')}" data-q>
      <button class="btn" data-act="add">Add item</button><button class="btn" data-act="csv">Export CSV</button></div>
    <div class="actions">${['', ...Object.keys(CATEGORIES)].map((k) => `<button class="btn small ${cat === k ? 'primary' : ''}" data-cat="${k}">${k ? esc(CATEGORIES[k]) : 'All'} <span class="muted">${k ? all.filter((c) => c.cat === k).length : all.length}</span></button>`).join('')}</div>
    <p class="callout small">Part numbers marked <span class="verify">verify</span> are commonly listed but not confirmed for this exact car. Check them against your VIN or the old part. Numbers without the mark come from the owner guide. Tap any line to edit it.${unverified ? ` ${unverified} lines need checking.` : ''}</p>
    ${Object.keys(CATEGORIES).filter((k) => shown.some((c) => c.cat === k)).map((k) => `<section><h3>${esc(CATEGORIES[k])}</h3><ul class="list">${shown.filter((c) => c.cat === k).map((c) => itemRow(c, st)).join('')}</ul></section>`).join('') || '<p class="muted">No matches.</p>'}`;

  const qi = el.querySelector('[data-q]');
  qi.oninput = () => { app.catQuery = qi.value; renderCatalog(app, el, { header }); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  el.onclick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { app.specMode = m.dataset.mode; return app.renderPanel(); }
    const c = e.target.closest('[data-cat]');
    if (c) { app.catFilter = c.dataset.cat; return renderCatalog(app, el, { header }); }
    const p = e.target.closest('[data-part]');
    if (p) { e.stopPropagation(); return app.openPart(+p.dataset.part); }
    const it = e.target.closest('[data-cid]');
    if (it) return editItem(app, all.find((x) => x.id === it.dataset.cid));
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'add') return editItem(app, null);
    if (a === 'csv') return download(new Blob([toCSV(all, st)], { type: 'text/csv' }), `${st.vehicle.name.replace(/\W+/g, '-')}-parts-catalog.csv`);
  };
}

export const pnHTML = (pns) => (pns || []).map((p) => `<span class="pn">${esc(p.brand)} <b>${p.pn ? esc(p.pn) : '<span class="muted">no number</span>'}</b>${p.verified ? '' : ' <span class="verify">verify</span>'}${p.note ? `<span class="muted small"> · ${esc(p.note)}</span>` : ''}</span>`).join('');

function itemRow(c, st) {
  const parts = st.parts.filter((p) => c.parts.includes(p.key)).slice(0, 4);
  return `<li class="row-item cat-item" data-cid="${esc(c.id)}"><div class="grow">
    <div>${esc(c.name)}${c.qty > 1 ? ` <span class="muted small">×${c.qty}</span>` : ''}${c.safety ? ' <span class="crit" title="Safety-critical">!</span>' : ''}</div>
    ${c.spec ? `<div class="small">${esc(c.spec)}</div>` : ''}
    ${c.capacity ? `<div class="small"><span class="muted">Capacity:</span> ${esc(c.capacity)}</div>` : ''}
    ${c.pns?.length ? `<div class="pns">${pnHTML(c.pns)}</div>` : ''}
    ${c.fab ? `<div class="small fab"><span class="muted">Make it:</span> ${esc(c.fab)}</div>` : ''}
    ${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}
    <div class="tags">${parts.map((p) => `<span class="tag" data-part="${p.id}">${esc(p.name)}</span>`).join('')}</div></div></li>`;
}

function editItem(app, c) {
  const v = app.st.vehicle;
  const isNew = !c;
  c ||= { id: `u_${Date.now().toString(36)}`, name: '', cat: 'part', parts: [], qty: 1, pns: [] };
  const pnText = (c.pns || []).map((p) => `${p.brand || ''} | ${p.pn || ''}${p.verified ? '' : ' | verify'}`).join('\n');
  modal(isNew ? 'Add catalog item' : c.name, `<form class="form">
    <label>Name<input name="name" value="${esc(c.name)}" required></label>
    <div class="grid2"><label>Category<select name="cat">${Object.entries(CATEGORIES).map(([k, n]) => `<option value="${k}" ${c.cat === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label><label>Qty<input name="qty" type="number" value="${c.qty || 1}"></label></div>
    <label>Spec<input name="spec" value="${esc(c.spec || '')}"></label>
    <label>Capacity<input name="capacity" value="${esc(c.capacity || '')}"></label>
    <label>Part numbers (one per line: brand | number | verify)<textarea name="pns" rows="3">${esc(pnText)}</textarea></label>
    <label>How to fabricate<textarea name="fab" rows="2">${esc(c.fab || '')}</textarea></label>
    <label>Note<textarea name="note" rows="2">${esc(c.note || '')}</textarea></label>
    <label>For parts<select name="parts" multiple size="6">${app.st.parts.map((p) => `<option value="${esc(p.key)}" ${c.parts.includes(p.key) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <div class="row between">${c.userEdited || c.custom ? '<button class="btn danger" type="button" data-reset>Reset</button>' : '<span></span>'}<span><button class="btn" type="button" data-close>Cancel</button> <button class="btn primary" type="submit">Save</button></span></div></form>`, {
    onMount: (root, close) => {
      const r = root.querySelector('[data-reset]');
      if (r) r.onclick = async () => { await saveCatalogItem(v.id, c.id, null); close(); app.refresh(); };
    },
    onSubmit: async (fd, form) => {
      const pns = fd.get('pns').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0] || x[1])
        .map(([brand, pn, flag]) => ({ brand, pn: pn || null, verified: !/verify/i.test(flag || '') }));
      await saveCatalogItem(v.id, c.id, {
        name: fd.get('name').trim(), cat: fd.get('cat'), qty: +fd.get('qty') || 1, spec: fd.get('spec').trim(), capacity: fd.get('capacity').trim(),
        fab: fd.get('fab').trim(), note: fd.get('note').trim(), pns, parts: [...form.querySelector('[name=parts]').selectedOptions].map((o) => o.value),
      });
      await app.refresh();
    },
  });
}

function toCSV(items, st) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const pname = new Map(st.parts.map((p) => [p.key, p.name]));
  const rows = [['Category', 'Item', 'Qty', 'Spec', 'Capacity', 'Part numbers', 'Verified', 'Fabricate', 'Note', 'Parts']];
  for (const c of items) rows.push([CATEGORIES[c.cat] || c.cat, c.name, c.qty, c.spec, c.capacity, (c.pns || []).map((p) => `${p.brand} ${p.pn || '(none)'}`).join('; '), (c.pns || []).length ? ((c.pns || []).every((p) => p.verified) ? 'yes' : 'no') : '', c.fab, c.note, c.parts.map((k) => pname.get(k)).filter(Boolean).join('; ')]);
  return rows.map((r) => r.map(q).join(',')).join('\n');
}
