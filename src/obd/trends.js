// Session trends: compare the same test over time.
//
// Each OBD session can be tagged with a test (warm idle, highway cruise, cold
// start...). When it is saved, the app works out a few summary numbers from the
// rows that match the test's conditions (for example, only warm-idle rows for
// the idle test). Those summaries are small, so they can sync; the raw rows stay
// on the device that recorded them. Trend charts then plot one point per
// session for the same test and metric.

import { rangesFor, stateOf } from './diagnostics.js';
import { cleanRows } from './filter.js';

export const METRICS_V = 1; // bump to recompute stored summaries

export const TESTS = {
  drive: { name: 'General drive', how: 'Any drive. Summaries use whatever warm idle and cruise the drive contains.' },
  idle: { name: 'Warm idle', how: 'Engine fully warm, in neutral, parking brake on, no A/C, about 3 minutes.' },
  cruise: { name: 'Steady cruise', how: 'Highway at a steady speed (about 55 to 65 mph), light throttle, 3 to 5 minutes.' },
  hold2500: { name: '2,500 rpm hold', how: 'Warm, in neutral, hold 2,500 rpm for 1 minute.' },
  cold: { name: 'Cold start', how: 'Start after the car sat overnight, record until the coolant is fully warm.' },
  charging: { name: 'Charging check', how: 'Warm idle with headlights, blower on high and rear defrost on, 2 minutes.' },
};

// Row selectors. Each metric is computed from the rows its selector keeps.
const SEL = {
  idle: (r, R) => stateOf(r, R) === 'idle',
  cruise: (r, R) => stateOf(r, R) === 'cruise',
  hold2500: (r, R) => r.rpm >= 2200 && r.rpm <= 2800 && (r.speed ?? 0) < 2 && (r.coolant == null || r.coolant >= R.warmCoolant),
  running: (r) => (r.rpm ?? 0) > 400,
  all: () => true,
};

const vals = (rows, ch) => rows.map((r) => r[ch]).filter((v) => v != null && Number.isFinite(v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const totalTrim = (r, b) => (r[`stft${b}`] == null && r[`ltft${b}`] == null ? null : (r[`stft${b}`] ?? 0) + (r[`ltft${b}`] ?? 0));

// Metric definitions. sel: row selector; f: rows → number. parts: part keys whose
// page shows this trend. range(R): healthy band from the vehicle's ranges.
export const METRICS = {
  idle_rpm: { label: 'Idle speed', unit: 'rpm', dp: 0, sel: 'idle', f: (rs) => mean(vals(rs, 'rpm')), range: (R) => R.idleRpm, parts: ['throttle_body', 'intake_gasket'] },
  idle_rpm_std: { label: 'Idle steadiness (rpm spread)', unit: 'rpm', dp: 0, sel: 'idle', f: (rs) => std(vals(rs, 'rpm')), range: (R) => [0, R.idleRpmStd], parts: ['plugs', 'coils', 'injectors', 'throttle_body', 'engine_mount_L', 'engine_mount_R'] },
  idle_trim1: { label: 'Total fuel trim B1 at idle', unit: '%', dp: 1, sel: 'idle', f: (rs) => mean(rs.map((r) => totalTrim(r, 1)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['intake_gasket', 'maf', 'o2_up_1', 'pcv'] },
  idle_trim2: { label: 'Total fuel trim B2 at idle', unit: '%', dp: 1, sel: 'idle', f: (rs) => mean(rs.map((r) => totalTrim(r, 2)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['intake_gasket', 'maf', 'o2_up_2', 'pcv'] },
  idle_maf: { label: 'MAF at idle', unit: 'g/s', dp: 2, sel: 'idle', f: (rs) => mean(vals(rs, 'maf')), range: (R) => R.mafIdlePerL.map((x) => x * R.displacementL), parts: ['maf', 'air_filter'] },
  idle_timing: { label: 'Timing at idle', unit: '°', dp: 1, sel: 'idle', f: (rs) => mean(vals(rs, 'timing')), range: (R) => R.idleTiming, parts: [] },
  idle_volt: { label: 'Charging voltage at idle', unit: 'V', dp: 2, sel: 'idle', f: (rs) => mean(vals(rs, 'voltage')), range: (R) => [R.voltageRun[0] - 0.3, R.voltageRun[1]], parts: ['alternator', 'battery', 'belt'] },
  cruise_trim1: { label: 'Total fuel trim B1 at cruise', unit: '%', dp: 1, sel: 'cruise', f: (rs) => mean(rs.map((r) => totalTrim(r, 1)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['maf', 'fuel_filter', 'fuel_pump', 'o2_up_1'] },
  cruise_trim2: { label: 'Total fuel trim B2 at cruise', unit: '%', dp: 1, sel: 'cruise', f: (rs) => mean(rs.map((r) => totalTrim(r, 2)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['maf', 'fuel_filter', 'fuel_pump', 'o2_up_2'] },
  cruise_coolant: { label: 'Coolant at cruise', unit: '°F', dp: 0, sel: 'cruise', f: (rs) => mean(vals(rs, 'coolant')), range: (R) => R.coolantRun, parts: ['thermostat', 'radiator', 'fan', 'water_pump'] },
  cruise_volt: { label: 'Charging voltage at cruise', unit: 'V', dp: 2, sel: 'cruise', f: (rs) => mean(vals(rs, 'voltage')), range: (R) => R.voltageRun, parts: ['alternator', 'battery', 'belt'] },
  hold_trim1: { label: 'Total fuel trim B1 at 2,500 rpm', unit: '%', dp: 1, sel: 'hold2500', f: (rs) => mean(rs.map((r) => totalTrim(r, 1)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['maf', 'o2_up_1'] },
  hold_trim2: { label: 'Total fuel trim B2 at 2,500 rpm', unit: '%', dp: 1, sel: 'hold2500', f: (rs) => mean(rs.map((r) => totalTrim(r, 2)).filter((v) => v != null)), range: (R) => [-R.trimTotal, R.trimTotal], parts: ['maf', 'o2_up_2'] },
  hold_maf: { label: 'MAF at 2,500 rpm', unit: 'g/s', dp: 2, sel: 'hold2500', f: (rs) => mean(vals(rs, 'maf')), parts: ['maf', 'air_filter'] },
  max_coolant: { label: 'Highest coolant', unit: '°F', dp: 0, sel: 'running', f: (rs) => { const v = vals(rs, 'coolant'); return v.length ? Math.max(...v) : null; }, range: (R) => [-Infinity, R.coolantHot], parts: ['thermostat', 'radiator', 'fan', 'coolant'] },
  min_volt_run: { label: 'Lowest voltage while running', unit: 'V', dp: 2, sel: 'running', f: (rs) => { const v = vals(rs, 'voltage'); return v.length ? Math.min(...v) : null; }, range: (R) => [R.voltageRun[0] - 0.5, Infinity], parts: ['alternator', 'battery'] },
  warmup_s: { label: 'Time to warm up', unit: 'min', dp: 1, sel: 'all', f: (rs, R) => warmupMinutes(rs, R), parts: ['thermostat'] },
};

// Which metrics each test reports, in display order.
export const TEST_METRICS = {
  drive: ['idle_rpm', 'idle_trim1', 'idle_trim2', 'cruise_trim1', 'cruise_trim2', 'cruise_coolant', 'cruise_volt', 'max_coolant', 'min_volt_run'],
  idle: ['idle_rpm', 'idle_rpm_std', 'idle_trim1', 'idle_trim2', 'idle_maf', 'idle_timing', 'idle_volt', 'max_coolant'],
  cruise: ['cruise_trim1', 'cruise_trim2', 'cruise_coolant', 'cruise_volt'],
  hold2500: ['hold_trim1', 'hold_trim2', 'hold_maf', 'idle_trim1', 'idle_trim2'],
  cold: ['warmup_s', 'max_coolant', 'idle_rpm'],
  charging: ['idle_volt', 'min_volt_run', 'idle_rpm'],
};

const MIN_ROWS = 5;

// Minutes from the first running row to the first row at the warm-coolant mark.
// Null unless the log starts cold.
function warmupMinutes(rows, R) {
  const run = rows.filter((r) => (r.rpm ?? 0) > 400 && r.coolant != null);
  if (run.length < MIN_ROWS || run[0].coolant >= R.warmCoolant - 40) return null;
  const warm = run.find((r) => r.coolant >= R.warmCoolant);
  return warm ? (warm.t - run[0].t) / 60 : null;
}

// rows: session rows (t in seconds). Returns { v, test, metrics: { id: { v, n } } }.
export function summarizeSession(rows, test = 'drive', vehicle) {
  const R = rangesFor(vehicle);
  const sorted = (rows || []).filter((r) => r && r.t != null).sort((a, b) => a.t - b.t);
  const clean = cleanRows(sorted).rows; // single impossible readings can't move a trend
  const metrics = {};
  for (const id of TEST_METRICS[test] || TEST_METRICS.drive) {
    const m = METRICS[id];
    const rs = clean.filter((r) => SEL[m.sel](r, R));
    if (m.sel !== 'all' && rs.length < MIN_ROWS) continue;
    const v = m.f(rs, R);
    if (v != null && Number.isFinite(v)) metrics[id] = { v: Math.round(v * 1000) / 1000, n: rs.length };
  }
  return { v: METRICS_V, test, metrics };
}

// Trend points for one test and metric: [{ date, v, n, name, id }], oldest first.
export function trendPoints(sessions, test, metric) {
  return sessions
    .filter((s) => (s.test || 'drive') === test && s.summary?.metrics?.[metric])
    .map((s) => ({ id: s.id, date: s.date, v: s.summary.metrics[metric].v, n: s.summary.metrics[metric].n, name: s.name }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Metrics that have at least `min` points for a test, for the pickers.
export function availableMetrics(sessions, test, min = 1) {
  return (TEST_METRICS[test] || []).filter((id) => trendPoints(sessions, test, id).length >= min);
}

// Trends worth showing on a part page: [{ test, metric, points }], best first.
export function trendsForPart(sessions, partKey) {
  const out = [];
  for (const [id, m] of Object.entries(METRICS)) {
    if (!m.parts.includes(partKey)) continue;
    for (const test of Object.keys(TESTS)) {
      if (!(TEST_METRICS[test] || []).includes(id)) continue;
      const points = trendPoints(sessions, test, id);
      if (points.length) out.push({ test, metric: id, points });
    }
  }
  return out.sort((a, b) => b.points.length - a.points.length);
}

// Healthy band for a metric on this vehicle, or null.
export function metricRange(id, vehicle) {
  const r = METRICS[id]?.range;
  return r ? r(rangesFor(vehicle)) : null;
}
