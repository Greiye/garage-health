import { db, todayISO } from '../data/db.js';
import { saveService } from '../data/repo.js';
import { SYSTEMS } from '../data/templates.js';
import { dotToDate } from '../data/health.js';
import { esc, modal, num, toast, blobURL, $, $$ } from './util.js';

export const SERVICE_TYPES = ['Maintenance', 'Repair', 'Replacement', 'Inspection', 'Upgrade / mod'];

// Component fields shared by the service form and the part panel.
export function componentFieldsHTML(part, c = {}, prefix = '') {
  const tire = part.kind === 'tire';
  const f = (name, label, val, attrs = '') => `<label>${label}<input name="${prefix}${name}" value="${esc(val ?? '')}" ${attrs}></label>`;
  return `<div class="grid2">
    ${f('brand', 'Brand', c.brand)}
    ${f('model', tire ? 'Tire model' : 'Model / line', c.model)}
    ${f('partNumber', 'Part number', c.partNumber)}
    ${tire ? f('size', 'Size', c.size, 'placeholder="225/55R16"') : f('vendor', 'Bought from', c.vendor)}
    ${tire ? f('dot', 'DOT date code (WWYY)', c.dot, 'inputmode="numeric" maxlength="4" placeholder="2321"') : f('mfgDate', 'Manufacture date', c.mfgDate, 'type="date"')}
    ${f('price', 'Price', c.price, 'type="number" step="0.01" inputmode="decimal"')}
    ${tire ? f('vendor', 'Bought from', c.vendor) : f('warrantyMonths', 'Warranty (months)', c.warrantyMonths, 'type="number"')}
    ${tire ? f('warrantyMiles', 'Treadwear warranty (mi)', c.warrantyMiles, 'type="number"') : ''}
  </div>`;
}

export function readComponentFields(fd, prefix = '', part) {
  const g = (k) => (fd.get(prefix + k) ?? '').toString().trim();
  const c = {
    brand: g('brand'), model: g('model'), partNumber: g('partNumber'), vendor: g('vendor'),
    price: num(g('price')), warrantyMonths: num(g('warrantyMonths')), warrantyMiles: num(g('warrantyMiles')),
  };
  if (part?.kind === 'tire') {
    c.size = g('size');
    c.dot = g('dot');
    c.mfgDate = dotToDate(c.dot);
  } else c.mfgDate = g('mfgDate') || null;
  return c;
}

export function openServiceForm(app, { service = null, partIds = [], title = '', type = 'Maintenance', replace = false } = {}) {
  const { st } = app;
  const v = st.vehicle;
  const s = service || { date: todayISO(), miles: v.odometer, partIds, title, type, cost: '', notes: '', shop: '' };
  const sel = new Set(s.partIds || []);
  const replSet = new Set(replace ? partIds : []);
  const bySystem = new Map(SYSTEMS.map((x) => [x, []]));
  for (const p of st.parts) (bySystem.get(p.system) || bySystem.set(p.system, []).get(p.system)).push(p);

  const html = `<form class="form" autocomplete="off">
    <div class="grid2">
      <label>Date<input type="date" name="date" value="${esc(s.date)}" required></label>
      <label>Odometer (mi)<input type="number" name="miles" value="${esc(s.miles ?? '')}" inputmode="numeric"></label>
      <label class="span2">Title<input name="title" value="${esc(s.title)}" placeholder="Oil change, front pads, strut swap…" required></label>
      <label>Type<select name="type">${SERVICE_TYPES.map((t) => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Total cost ($)<input type="number" step="0.01" name="cost" value="${esc(s.cost ?? '')}" inputmode="decimal"></label>
      <label>Shop / done by<input name="shop" value="${esc(s.shop || '')}" placeholder="DIY"></label>
      <label>Labor hours<input type="number" step="0.1" name="hours" value="${esc(s.hours ?? '')}"></label>
    </div>
    <fieldset><legend>Parts touched</legend>
      <input type="search" class="part-search" placeholder="Filter parts…">
      <div class="part-picker">${[...bySystem].filter(([, ps]) => ps.length).map(([sys, ps]) => `
        <div class="pp-group"><div class="pp-sys">${esc(sys)}</div>
        ${ps.map((p) => `<label class="pp-item" data-name="${esc(p.name.toLowerCase())}"><input type="checkbox" name="part" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
        </div>`).join('')}</div>
    </fieldset>
    ${service ? '' : `<fieldset><legend>New parts installed</legend><p class="muted small">Tick "replaced" for parts you swapped. Each gets its own record (brand, part number, date) and the old one goes to history.</p><div class="repl-list"></div></fieldset>`}
    <fieldset><legend>Photos & receipts</legend>
      <div class="grid3">
        <label class="file">Before photos<input type="file" name="before" accept="image/*" multiple></label>
        <label class="file">After photos<input type="file" name="after" accept="image/*" multiple></label>
        <label class="file">Receipts (PDF, WebP, photo)<input type="file" name="receipt" accept="application/pdf,image/webp,image/*,.pdf,.webp" multiple></label>
      </div>
      <div class="existing-att"></div>
    </fieldset>
    <label>Notes<textarea name="notes" rows="3" placeholder="Torque specs used, what you found, tips for next time…">${esc(s.notes || '')}</textarea></label>
    <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${service ? 'Save changes' : 'Save service'}</button></div>
  </form>`;

  const renderRepl = (root) => {
    const list = $('.repl-list', root);
    if (!list) return;
    const checked = $$('input[name=part]:checked', root).map((i) => +i.value);
    if (!checked.length) { list.innerHTML = '<p class="muted small">Select parts above first.</p>'; return; }
    // keep existing inputs' values
    const prev = new Map($$('[data-repl]', list).map((d) => [+d.dataset.repl, d]));
    list.innerHTML = '';
    for (const pid of checked) {
      const p = st.parts.find((x) => x.id === pid);
      if (prev.has(pid)) { list.appendChild(prev.get(pid)); continue; }
      const d = document.createElement('div');
      d.className = 'repl';
      d.dataset.repl = pid;
      d.innerHTML = `<label class="chk"><input type="checkbox" name="repl_${pid}" ${replSet.has(pid) ? 'checked' : ''}> Replaced <b>${esc(p.name)}</b></label>
        <div class="repl-fields" ${replSet.has(pid) ? '' : 'hidden'}>${componentFieldsHTML(p, {}, `c${pid}_`)}</div>`;
      d.querySelector('input').addEventListener('change', (e) => (d.querySelector('.repl-fields').hidden = !e.target.checked));
      list.appendChild(d);
    }
  };

  modal(service ? 'Edit service' : 'Log service', html, {
    wide: true,
    onMount: async (root) => {
      renderRepl(root);
      $('.part-picker', root).addEventListener('change', () => renderRepl(root));
      $('.part-search', root).addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        $$('.pp-item', root).forEach((el) => (el.hidden = q && !el.dataset.name.includes(q)));
      });
      if (service) {
        const atts = await db.attachments.where({ serviceId: service.id }).toArray();
        $('.existing-att', root).innerHTML = atts.map((a) => `<span class="att-chip" data-att="${a.id}">${a.type.startsWith('image') ? `<img src="${blobURL(a)}">` : '📄'} ${esc(a.kind)} <button type="button" class="icon-btn" data-del-att="${a.id}">✕</button></span>`).join('');
        root.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-del-att]');
          if (!b) return;
          await db.attachments.delete(+b.dataset.delAtt);
          b.closest('.att-chip').remove();
        });
      }
    },
    onSubmit: async (fd) => {
      const ids = fd.getAll('part').map(Number);
      const entry = {
        ...(service ? { id: service.id } : {}),
        vehicleId: v.id, date: fd.get('date'), miles: num(fd.get('miles')), title: fd.get('title').trim(), type: fd.get('type'),
        cost: num(fd.get('cost')), shop: fd.get('shop').trim(), hours: num(fd.get('hours')), notes: fd.get('notes').trim(), partIds: ids,
        resets: service?.resets || [],
      };
      const replacements = [];
      for (const pid of ids) {
        if (fd.get(`repl_${pid}`)) replacements.push({ partId: pid, component: readComponentFields(fd, `c${pid}_`, st.parts.find((p) => p.id === pid)) });
      }
      const files = [];
      for (const kind of ['before', 'after', 'receipt']) for (const f of fd.getAll(kind)) if (f && f.size) files.push({ kind, file: f });
      await saveService(entry, { replacements, files });
      toast(service ? 'Service updated' : 'Service logged');
      await app.refresh();
    },
  });
}
