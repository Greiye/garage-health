import { saveService } from '../data/repo.js';
import { todayISO } from '../data/db.js';
import { esc, toast } from './util.js';
import { openWatch } from './partPanel.js';

// Press and hold on a part of the 3D model: Checked OK / Watch / Open, per part in that spot.
export function openHoldMenu(app, slot, x, y) {
  const st = app.st;
  const parts = st.parts.filter((p) => p.slot === slot);
  if (!parts.length) return;
  const odo = st.vehicle.odometer;
  const rows = parts.map((p) => `<li class="hold-row">
      <div class="hold-name">${esc(p.name)}</div>
      <div class="hold-btns">${p.inspect ? `<button class="btn small" data-ok="${p.id}">Checked OK</button><button class="btn small" data-watch="${p.id}">Watch</button>` : ''}
      <button class="btn small" data-open="${p.id}">Open</button></div></li>`).join('');
  const wrap = document.createElement('div');
  wrap.className = 'hold-menu-wrap';
  const left = Math.min(window.innerWidth - 308, Math.max(8, x - 150));
  const top = Math.min(window.innerHeight - 200, Math.max(8, y + 12));
  wrap.innerHTML = `<div class="hold-menu" style="left:${left}px;top:${top}px">
      <div class="row between"><b>${esc(app.viewer.label(slot))}</b>${parts.length > 1 ? '<button class="btn small" data-okall>Check all</button>' : ''}</div>
      <ul class="hold-list">${rows}</ul>
      <div class="row end"><button class="btn small" data-close>Close</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const ok = e.target.closest('[data-ok]');
    const all = e.target.closest('[data-okall]');
    const watch = e.target.closest('[data-watch]');
    const open = e.target.closest('[data-open]');
    if (open) { close(); return app.openPart(+open.dataset.open); }
    if (watch) { close(); return openWatch(app, st.parts.find((p) => p.id === +watch.dataset.watch)); }
    const targets = all ? parts.filter((p) => p.inspect) : ok ? [st.parts.find((p) => p.id === +ok.dataset.ok)] : null;
    if (!targets) return;
    close();
    for (const p of targets) {
      await saveService({ vehicleId: st.vehicle.id, date: todayISO(), miles: odo, title: `${p.name} checked`, type: 'Inspection', partIds: [p.id], cost: null, notes: p.pm?.what ? `Checked: ${p.pm.what}` : '' });
    }
    toast(targets.length > 1 ? `${targets.length} parts checked` : `${targets[0].name} checked`);
    await app.refresh();
  });
}
