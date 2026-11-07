import { saveService } from '../data/repo.js';
import { SYSTEMS } from '../data/templates.js';
import { esc, modal, num, toast } from './util.js';

// Bulk entry of "last done" dates and mileage so a car with history gets
// accurate colors in one pass instead of opening every part.
export function openBaseline(app) {
  const { st } = app;
  const parts = st.parts.filter((p) => (p.im || p.mo) && st.health.get(p.id).level === 'unknown');
  if (!parts.length) return toast('Every interval part already has a service date');
  const rows = SYSTEMS.map((sys) => {
    const ps = parts.filter((p) => p.system === sys);
    if (!ps.length) return '';
    return `<tr><th colspan="3" class="pp-sys">${esc(sys)}</th></tr>` + ps.map((p) => `<tr><td>${esc(p.name)}<div class="muted small">every ${[p.im && `${p.im.toLocaleString()} mi`, p.mo && `${p.mo} mo`].filter(Boolean).join(' / ')}</div></td>
      <td><input type="date" name="d_${p.id}"></td><td><input type="number" name="m_${p.id}" placeholder="miles" inputmode="numeric"></td></tr>`).join('');
  }).join('');
  modal('Enter known history', `<form class="form">
    <p class="muted small">Fill in the last time each item was done, as best you know. Leave a row blank if you don't know. A date alone or miles alone is fine. Each row becomes a log entry.</p>
    <table class="tbl baseline">${rows}</table>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save history</button></div></form>`, {
    wide: true,
    onSubmit: async (fd) => {
      let n = 0;
      for (const p of parts) {
        const date = fd.get(`d_${p.id}`), miles = num(fd.get(`m_${p.id}`));
        if (!date && miles == null) continue;
        await saveService({ vehicleId: st.vehicle.id, date: date || null, miles, title: p.name, type: 'Maintenance', partIds: [p.id], notes: 'Entered as known history', baseline: true, resolveFlags: false });
        n++;
      }
      toast(`Saved ${n} history entr${n === 1 ? 'y' : 'ies'}`);
      await app.refresh();
    },
  });
}
