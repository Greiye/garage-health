import { db, todayISO } from '../data/db.js';
import { monthsBetween } from '../data/health.js';
import { LEVELS } from '../data/health.js';
import { inspectionDefs } from '../data/repo.js';
import { evaluateTest } from '../data/inspection.js';
import { CHANNELS } from '../obd/pids.js';
import { download } from './util.js';

// CSV exports. Everything opens in Excel / Google Sheets. OBD sessions use
// OBD Fusion-style "Name (unit)" headers so they re-import cleanly.

const q = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'); // BOM so Excel reads UTF-8 (°, ±)
const slug = (s) => String(s).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
const save = (st, what, rows) => download(new Blob([toCsv(rows)], { type: 'text/csv' }), `${slug(st.vehicle.name)}-${what}-${todayISO()}.csv`);
const r1 = (n) => (n == null || Number.isNaN(n) ? '' : Math.round(n * 10) / 10);

export async function exportServicesCsv(st) {
  const pname = new Map(st.allParts.map((p) => [p.id, p.name]));
  const atts = await db.attachments.where({ vehicleId: st.vehicle.id }).toArray();
  const repl = new Map();
  for (const c of st.components) if (c.installServiceId) (repl.get(c.installServiceId) || repl.set(c.installServiceId, []).get(c.installServiceId)).push(c);
  const rows = [['Date', 'Odometer (mi)', 'Title', 'Type', 'Parts touched', 'Parts installed (brand / part #)', 'Cost ($)', 'Shop', 'Labor hours', 'Photos', 'Receipts', 'Notes']];
  const list = st.services.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
  for (const s of list) {
    const a = atts.filter((x) => x.serviceId === s.id);
    rows.push([s.date, s.miles, s.title, s.type, (s.partIds || []).map((id) => pname.get(id)).filter(Boolean).join('; '),
      (repl.get(s.id) || []).map((c) => `${pname.get(c.partId) || ''}: ${[c.brand, c.model].filter(Boolean).join(' ')}${c.partNumber ? ` #${c.partNumber}` : ''}`).join('; '),
      s.cost, s.shop, s.hours, a.filter((x) => x.kind !== 'receipt').length, a.filter((x) => x.kind === 'receipt').length, s.notes]);
  }
  save(st, 'service-log', rows);
}

export function exportPartsCsv(st) {
  const odo = st.vehicle.odometer;
  const rows = [['System', 'Part', 'Position', 'Health', 'Health %', 'Why', 'Brand', 'Model', 'Part number', 'Manufactured / DOT', 'Installed', 'Installed at (mi)', 'Miles on part', 'Interval (mi)', 'Interval (months)', 'Last service', 'Last service (mi)', 'Latest measurement', 'Active issues', 'Notes']];
  for (const p of [...st.parts].sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name))) {
    const h = st.health.get(p.id), c = st.component.get(p.id), last = st.lastService.get(p.id);
    const m = (c?.measurements || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    rows.push([p.system, p.name, p.position || '', LEVELS[h.level].label, h.frac == null ? '' : Math.round(h.frac * 100), h.reasons.map((r) => r.text).join('; '),
      c?.brand, c?.model, c?.partNumber, c?.dot || c?.mfgDate, c?.installDate, c?.installMiles, c?.installMiles != null && odo != null ? odo - c.installMiles : '',
      p.im || '', p.mo || '', last?.date, last?.miles, m ? `${m.value} ${p.measure?.unit || ''} (${m.date})` : '',
      st.flags.filter((f) => f.partId === p.id).map((f) => f.text).join('; '), p.notes]);
  }
  save(st, 'parts-health', rows);
}

export function exportTiresCsv(st) {
  const tireParts = st.allParts.filter((p) => p.kind === 'tire');
  const ids = new Set(tireParts.map((p) => p.id));
  const pos = (id) => st.allParts.find((p) => p.id === id)?.position || '?';
  const rows = [['Status', 'Current position', 'Brand', 'Model', 'Size', 'DOT', 'Manufactured', 'Age (years)', 'Installed', 'Installed at (mi)', 'Removed', 'Removed at (mi)', 'Miles used', 'Latest tread (/32")', 'Tread history', 'Position history', 'Price ($)', 'Vendor', 'Treadwear warranty (mi)']];
  const comps = st.components.filter((c) => ids.has(c.partId) || (c.positionHistory || []).some((x) => ids.has(x.partId)));
  for (const c of comps.sort((a, b) => (a.removedDate ? 1 : 0) - (b.removedDate ? 1 : 0))) {
    const ms = (c.measurements || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const endMi = c.removedMiles ?? st.vehicle.odometer;
    rows.push([c.removedDate ? 'Removed' : 'On car', c.removedDate ? '' : pos(c.partId), c.brand, c.model, c.size, c.dot, c.mfgDate,
      c.mfgDate ? r1(monthsBetween(c.mfgDate, c.removedDate || todayISO()) / 12) : '', c.installDate, c.installMiles, c.removedDate, c.removedMiles,
      c.installMiles != null && endMi != null ? endMi - c.installMiles : '', ms.at(-1)?.value, ms.map((m) => `${m.date}: ${m.value}`).join('; '),
      (c.positionHistory || []).map((x) => `${x.date || '?'} ${pos(x.partId)}`).join(' → '), c.price, c.vendor, c.warrantyMiles]);
  }
  save(st, 'tires', rows);
}

export function exportCostsCsv(st) {
  const pname = new Map(st.allParts.map((p) => [p.id, p]));
  const byYear = new Map();
  for (const s of st.services) {
    if (!s.cost || !s.date) continue;
    const y = s.date.slice(0, 4);
    const systems = [...new Set((s.partIds || []).map((id) => pname.get(id)?.system).filter(Boolean))];
    const sys = systems.length === 1 ? systems[0] : systems.length ? 'Multiple' : 'Other';
    const k = `${y}|${sys}`;
    const e = byYear.get(k) || { y, sys, total: 0, n: 0 };
    e.total += s.cost; e.n++;
    byYear.set(k, e);
  }
  const rows = [['Year', 'System', 'Jobs', 'Total ($)']];
  for (const e of [...byYear.values()].sort((a, b) => a.y.localeCompare(b.y) || a.sys.localeCompare(b.sys))) rows.push([e.y, e.sys, e.n, e.total.toFixed(2)]);
  const years = [...new Set([...byYear.values()].map((e) => e.y))].sort();
  for (const y of years) rows.push([y, 'TOTAL', [...byYear.values()].filter((e) => e.y === y).reduce((a, e) => a + e.n, 0), [...byYear.values()].filter((e) => e.y === y).reduce((a, e) => a + e.total, 0).toFixed(2)]);
  save(st, 'costs', rows);
}

export function exportObdSessionCsv(st, s) {
  const chans = Object.keys(s.stats || {}).filter((c) => CHANNELS[c]);
  const rows = [['Time (sec)', ...chans.map((c) => `${CHANNELS[c].name} (${CHANNELS[c].unit})`)]];
  for (const r of s.rows || []) rows.push([r1(r.t), ...chans.map((c) => (r[c] == null ? '' : +r[c].toFixed(Math.max(CHANNELS[c].dp, 1))))]);
  download(new Blob([toCsv(rows)], { type: 'text/csv' }), `${slug(s.name.replace(/\.csv$/i, ''))}-${slug(st.vehicle.name)}.csv`);
}

export function exportInspectionCsv(st, run) {
  const { items, tests } = inspectionDefs(st.vehicle);
  const pname = new Map(st.allParts.map((p) => [p.key, p.name]));
  const rows = [['Section', 'Check', 'Result', 'Value', 'Unit', 'Note', 'Safety-critical', 'Parts']];
  if (run.kind === 'full') for (const it of items) {
    const r = run.results?.[it.id] || {};
    rows.push([it.sec, it.text, r.status || '', r.value ?? '', it.m?.unit || '', r.note || '', it.crit ? 'yes' : '', (it.parts || []).map((k) => pname.get(k) || k).join('; ')]);
  }
  for (const t of tests.filter((x) => run.tests?.[x.id])) {
    const tr = run.tests[t.id];
    const ev = evaluateTest(t, tr.values || {});
    rows.push(['Test', t.name, tr.status || ev.status || '', Object.entries(tr.values || {}).map(([k, v]) => `${k}=${v}`).join('; '), '', [tr.note, ...ev.notes.map((n) => n.text)].filter(Boolean).join('; '), '', (t.parts || []).map((k) => pname.get(k) || k).join('; ')]);
  }
  download(new Blob([toCsv(rows)], { type: 'text/csv' }), `${slug(st.vehicle.name)}-${slug(run.title)}-${run.date}.csv`);
}
