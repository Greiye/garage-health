// Preventive maintenance schedule: every replace/service and inspection task
// for the vehicle, sorted by when it's due (projected from miles driven per
// month), with one-tap "Done" / "Checked OK".
import { db, todayISO } from '../data/db.js';
import { saveService } from '../data/repo.js';
import { MODES } from '../data/schedule.js';
import { monthsBetween } from '../data/health.js';
import { esc, fmtMi, fmtDate, toast } from './util.js';

const DAY = 864e5;
const addMonths = (iso, m) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + m); return d; };

// Average miles per month from odometer history (needs 2 readings 2+ weeks apart).
export async function milesPerMonth(vehicleId) {
  const rows = (await db.odometer.where({ vehicleId }).toArray()).filter((r) => r.date && r.miles != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length < 2) return null;
  const a = rows[0], b = rows.at(-1);
  const months = monthsBetween(a.date, b.date);
  if (months < 0.5 || b.miles <= a.miles) return null;
  return (b.miles - a.miles) / months;
}

export function buildTasks(st, mpm) {
  const odo = st.vehicle.odometer;
  const today = new Date(todayISO() + 'T12:00:00');
  const tasks = [];
  for (const p of st.parts) {
    const comp = st.component.get(p.id);
    const last = st.lastService.get(p.id);
    let base = last ? { ...last } : null;
    if (comp && (comp.installDate || comp.installMiles != null) && (!base || (comp.installDate && base.date && comp.installDate > base.date))) base = { date: comp.installDate, miles: comp.installMiles };
    const ck = st.checked?.get(p.id);
    const defs = [];
    if (p.im || p.mo) defs.push({ kind: 'service', iv: { im: p.im, mo: p.mo }, base });
    if (p.inspect && (p.inspect.im || p.inspect.mo)) {
      let ib = base ? { ...base } : null;
      if (ck && (!ib || !ib.date || (ck.date || '') >= ib.date)) ib = { ...ck };
      defs.push({ kind: 'inspect', iv: p.inspect, base: ib });
    }
    if (p.life && (p.life.im || p.life.mo) && !(p.im || p.mo)) defs.push({ kind: 'life', iv: p.life, base });
    for (const d of defs) {
      const t = { part: p, kind: d.kind, iv: d.iv, base: d.base, what: d.kind === 'inspect' ? p.pm?.what : null, note: p.pm?.note, src: p.pm?.src };
      if (!d.base || (d.base.miles == null && !d.base.date)) { if (d.kind !== 'life') { t.status = 'never'; tasks.push(t); } continue; }
      const cands = [];
      if (d.iv.im && d.base.miles != null) {
        t.dueMiles = d.base.miles + d.iv.im;
        if (odo != null) {
          t.milesLeft = t.dueMiles - odo;
          if (mpm) cands.push(new Date(today.getTime() + (t.milesLeft / mpm) * 30.4375 * DAY));
          else if (t.milesLeft <= 0) cands.push(today);
        }
      }
      if (d.iv.mo && d.base.date) { t.dueDate = addMonths(d.base.date, d.iv.mo); cands.push(t.dueDate); }
      t.when = cands.length ? new Date(Math.min(...cands.map((x) => x.getTime()))) : null;
      const daysLeft = t.when ? (t.when - today) / DAY : Infinity;
      const overdue = (t.milesLeft != null && t.milesLeft <= 0) || (t.dueDate && t.dueDate <= today);
      if (d.kind === 'life') { t.status = overdue ? 'pastlife' : 'lifelater'; tasks.push(t); continue; }
      t.status = overdue ? 'overdue' : daysLeft <= 30 || (t.milesLeft != null && t.milesLeft <= 500) ? 'soon' : daysLeft <= 183 ? 'next6' : 'later';
      tasks.push(t);
    }
  }
  const order = { overdue: 0, soon: 1, pastlife: 2, next6: 3, later: 4, lifelater: 5, never: 6 };
  tasks.sort((a, b) => order[a.status] - order[b.status] || (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity) || a.part.name.localeCompare(b.part.name));
  return tasks;
}

const GROUPS = [
  ['overdue', 'Overdue'], ['soon', 'Due in the next month'], ['pastlife', 'Past typical life (inspect, plan replacement)'], ['next6', 'Next 6 months'], ['later', 'Later'], ['lifelater', 'Typical life (no factory interval)'], ['never', 'No history yet'],
];
const every = (iv) => [iv.im && `${iv.im.toLocaleString()} mi`, iv.mo && (iv.mo % 12 === 0 && iv.mo >= 12 ? `${iv.mo / 12} yr` : `${iv.mo} mo`)].filter(Boolean).join(' / ');

function taskRow(t) {
  const p = t.part;
  const dueBits = [t.dueMiles != null && fmtMi(t.dueMiles), t.dueDate && fmtDate(t.dueDate.toISOString().slice(0, 10))].filter(Boolean).join(' or ');
  const lifeTxt = (t.kind === 'life') ? (t.status === 'pastlife' ? `Past typical life${t.milesLeft != null && t.milesLeft < 0 ? ` by ${Math.abs(t.milesLeft).toLocaleString()} mi` : ''}. Not required, but check it and budget for it.` : `Typical life ~${t.when ? fmtDate(t.when.toISOString().slice(0, 10)) : ''}. Replace only if worn or leaking.`) : null;
  const left = lifeTxt ? lifeTxt : t.status === 'never' ? 'Log when it was last done to start tracking'
    : t.status === 'overdue' ? `Overdue${t.milesLeft != null && t.milesLeft < 0 ? ` by ${Math.abs(t.milesLeft).toLocaleString()} mi` : ''}${t.dueDate && t.dueDate < new Date() ? ` · since ${fmtDate(t.dueDate.toISOString().slice(0, 10))}` : ''}`
    : `${t.milesLeft != null ? `${t.milesLeft.toLocaleString()} mi left` : ''}${t.milesLeft != null && t.when ? ' · ' : ''}${t.when ? `~${fmtDate(t.when.toISOString().slice(0, 10))}` : ''}`;
  const dotCls = t.kind === 'life' ? (t.status === 'pastlife' ? 'lv-yellow' : 'lv-green') : t.status === 'overdue' ? (t.kind === 'service' ? 'lv-red blink' : 'lv-orange') : t.status === 'soon' ? 'lv-orange' : t.status === 'never' ? 'lv-unknown' : 'lv-green';
  return `<li class="row-item sched" data-part="${p.id}">
    <span class="dot ${dotCls}"></span>
    <div class="grow"><div>${esc(p.name)} <span class="tag tag-${t.kind}">${t.kind === 'service' ? 'Replace' : t.kind === 'life' ? 'Typical life' : p.pm?.key?.includes('gasket') || /gasket|seal/i.test(p.name) ? 'Leak check' : 'Inspect'}</span>${t.src && t.kind !== 'life' ? ` <span class="muted small">${esc(t.src)}</span>` : ''}</div>
      <div class="muted small">${t.kind === 'life' ? `Usually lasts ${esc(every(t.iv))}` : `Every ${esc(every(t.iv))}`}${dueBits && t.kind !== 'life' ? ` · due ${esc(dueBits)}` : ''}</div>
      <div class="small ${t.status === 'overdue' ? 'txt-orange' : 'muted'}">${esc(left)}</div>
      ${t.what ? `<div class="small muted">Check: ${esc(t.what)}</div>` : ''}</div>
    ${t.kind === 'life' ? `<button class="btn small" data-done="${p.id}" data-kind="service">Replaced</button>` : `<button class="btn small" data-done="${p.id}" data-kind="${t.kind}">${t.kind === 'service' ? 'Done' : 'Checked OK'}</button>`}
  </li>`;
}

export async function renderSchedule(app, el, header = '') {
  const st = app.st;
  const v = st.vehicle;
  const mode = v.scheduleMode || 'normal';
  const mpm = await milesPerMonth(v.id);
  const assumed = mpm ?? 1000;
  const tasks = buildTasks(st, assumed);
  const counts = Object.fromEntries(GROUPS.map(([k]) => [k, tasks.filter((t) => t.status === k).length]));
  const showLater = app.schedShowLater;
  el.innerHTML = `${header}
    <section class="card">
      <div class="sec-head"><h3>Maintenance schedule</h3>
        <div class="seg">${Object.entries(MODES).map(([k, m]) => `<button class="seg-b ${k === mode ? 'on' : ''}" data-mode="${k}">${m.label}</button>`).join('')}</div></div>
      <p class="muted small">${esc(MODES[mode].hint)} ${mode === 'normal' ? `Switch to Severe if that describes your driving (oil every 3,000 mi / 3 months).` : ''}</p>
      <p class="muted small">Whichever comes first, miles or time. Dates are projected from ${mpm ? `your average of ${Math.round(mpm).toLocaleString()} mi/month` : 'an assumed 1,000 mi/month (update the odometer now and then to use your real average)'}.
      Replace items go red and blink when overdue; inspections and leak checks go orange; parts past their typical life (no factory interval, like gaskets) go yellow. Ford's SN95 Mustang schedule is used where Ford gives an interval, and general guidance for the rest (approximate). Change any part's interval under its Intervals &amp; limits.</p>
    </section>
    ${GROUPS.map(([k, label]) => {
      if (!counts[k]) return '';
      if ((k === 'later' || k === 'never' || k === 'lifelater') && !showLater) return `<section><button class="btn small" data-more="${k}">Show ${label.toLowerCase()} (${counts[k]})</button></section>`;
      return `<section><h3>${label} <span class="muted small">${counts[k]}</span></h3><ul class="list">${tasks.filter((t) => t.status === k).map(taskRow).join('')}</ul></section>`;
    }).join('')}`;

  el.onclick = async (e) => {
    const hv = e.target.closest('[data-hview]');
    if (hv) { app.healthView = hv.dataset.hview; return app.renderPanel(); }
    const m = e.target.closest('[data-mode]');
    if (m) {
      await db.vehicles.update(v.id, { scheduleMode: m.dataset.mode });
      toast(`${MODES[m.dataset.mode].label} schedule`);
      return app.refresh();
    }
    if (e.target.closest('[data-more]')) { app.schedShowLater = true; return renderSchedule(app, el, header); }
    const d = e.target.closest('[data-done]');
    if (d) {
      const p = st.parts.find((x) => x.id === +d.dataset.done);
      const inspect = d.dataset.kind === 'inspect';
      await saveService({ vehicleId: v.id, date: todayISO(), miles: v.odometer ?? null, title: `${p.name}${inspect ? ' checked' : ''}`, type: inspect ? 'Inspection' : 'Maintenance', partIds: [p.id], cost: null, notes: inspect && p.pm?.what ? `Checked: ${p.pm.what}` : '' });
      toast(`${p.name} ${inspect ? 'checked' : 'done'} at ${fmtMi(v.odometer)}`);
      return app.refresh();
    }
    const r = e.target.closest('[data-part]');
    if (r) app.openPart(+r.dataset.part);
  };
}
