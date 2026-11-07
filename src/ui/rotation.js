import { todayISO } from '../data/db.js';
import { rotateTires } from '../data/repo.js';
import { esc, modal, num, toast } from './util.js';

const PATTERNS = {
  'rearward-cross': { label: 'Rearward cross (RWD / 4WD)', map: { tire_RL: 'tire_FL', tire_RR: 'tire_FR', tire_FL: 'tire_RR', tire_FR: 'tire_RL' } },
  'forward-cross': { label: 'Forward cross (FWD)', map: { tire_FL: 'tire_RL', tire_FR: 'tire_RR', tire_RL: 'tire_FR', tire_RR: 'tire_FL' } },
  x: { label: 'X pattern', map: { tire_FL: 'tire_RR', tire_FR: 'tire_RL', tire_RL: 'tire_FR', tire_RR: 'tire_FL' } },
  'front-rear': { label: 'Front ↔ rear, same side (directional tires)', map: { tire_FL: 'tire_RL', tire_RL: 'tire_FL', tire_FR: 'tire_RR', tire_RR: 'tire_FR' } },
  side: { label: 'Side ↔ side (staggered sizes)', map: { tire_FL: 'tire_FR', tire_FR: 'tire_FL', tire_RL: 'tire_RR', tire_RR: 'tire_RL' } },
};

export function openRotation(app) {
  const { st } = app;
  const dt = st.vehicle.options?.drivetrain;
  const def = dt === 'fwd' ? 'forward-cross' : 'rearward-cross';
  const tireAt = (key) => {
    const p = st.parts.find((x) => x.key === key);
    const c = p && st.component.get(p.id);
    return c ? [c.brand, c.model].filter(Boolean).join(' ') + (c.dot ? ` (DOT ${c.dot})` : '') || 'tire (no details)' : 'no record';
  };
  const preview = (pat) => Object.entries(PATTERNS[pat].map).map(([f, t]) => `<tr><td>${f.slice(5)}</td><td>${esc(tireAt(f))}</td><td>→ <b>${t.slice(5)}</b></td></tr>`).join('');
  modal('Rotate tires', `<form class="form">
    <label>Pattern<select name="pattern">${Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}" ${k === def ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <table class="tbl"><tr><th>From</th><th>Tire</th><th>To</th></tr><tbody class="rot-preview">${preview(def)}</tbody></table>
    <div class="grid2"><label>Date<input type="date" name="date" value="${todayISO()}"></label><label>Odometer<input type="number" name="miles" value="${st.vehicle.odometer ?? ''}"></label></div>
    <p class="muted small">Each tire keeps its own record and position history as it moves.</p>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save rotation</button></div></form>`, {
    onMount: (root) => root.querySelector('[name=pattern]').addEventListener('change', (e) => (root.querySelector('.rot-preview').innerHTML = preview(e.target.value))),
    onSubmit: async (fd) => {
      const pat = PATTERNS[fd.get('pattern')];
      await rotateTires(st.vehicle.id, pat.map, { date: fd.get('date'), miles: num(fd.get('miles')), notes: pat.label });
      toast('Rotation saved');
      await app.refresh();
    },
  });
}
