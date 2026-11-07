// OBD diagnostics engine.
//
// 1. Classify every sample into an engine state (cold, warm idle, cruise,
//    high load, decel, engine off).
// 2. Check readings against healthy ranges for that state. Ranges come from
//    generic gasoline defaults, then the vehicle catalog, then the vehicle's
//    own overrides, so every car can have its own numbers.
// 3. Run pattern rules that combine readings (and stored trouble codes) into
//    likely causes with a confidence level, the parts involved and the tests
//    that would confirm them.
//
// This narrows down causes; it does not prove a part has failed.

import { VEHICLE_CATALOGS } from '../data/catalogs/index.js';

// ---------- Healthy ranges ----------
export const GENERIC_RANGES = {
  displacementL: 2.5,
  warmCoolant: 175, // °F: at or above this the engine counts as warmed up
  idleRpm: [550, 900], // warm idle
  idleRpmStd: 60, // rpm standard deviation at warm idle
  coolantRun: [185, 220], // warm, driving
  coolantHot: 225,
  coolantCritical: 240,
  trimTotal: 10, // |STFT + LTFT| per bank, %
  trimLtft: 10,
  bankSplit: 8, // difference between banks, % points
  idleShiftFix: 6, // lean at idle that improves this much at cruise → vacuum leak
  mafIdlePerL: [0.75, 1.5], // g/s per litre at warm idle
  idleLoad: [12, 38], // %
  idleTiming: [8, 28], // °BTDC
  voltageRun: [13.3, 14.8],
  voltageOff: 12.4,
  o2Max: 0.75, // upstream should reach at least this
  o2Min: 0.2, // and drop below this
  o2SwitchHz: 0.5, // min upstream switches per second at cruise (needs ≥2 samples/s)
  catRatio: 0.6, // downstream activity / upstream activity above this → weak cat
  iatOverAmbient: 50,
  oilHot: 260,
};

// Effective ranges for a vehicle.
export function rangesFor(vehicle) {
  const disp = parseFloat(/(\d\.\d)\s*L/i.exec(vehicle?.engine || '')?.[1]);
  const cat = VEHICLE_CATALOGS[vehicle?.presetId]?.obdRanges || {};
  return { ...GENERIC_RANGES, ...(disp ? { displacementL: disp } : {}), ...cat, ...(vehicle?.obdRanges || {}) };
}

// ---------- Engine state ----------
export const STATES = {
  off: 'Engine off',
  cold: 'Warming up',
  idle: 'Warm idle',
  cruise: 'Steady cruise',
  load: 'High load',
  decel: 'Decel / fuel cut',
  other: 'Other driving',
};

export function stateOf(r, R) {
  const rpm = r.rpm;
  if (rpm == null) return null;
  if (rpm < 300) return 'off';
  if (r.coolant != null && r.coolant < R.warmCoolant) return 'cold';
  const thr = r.throttle, spd = r.speed, load = r.load;
  if ((thr ?? 0) < 3 && rpm > 1300 && (spd ?? 0) > 10) return 'decel';
  if ((spd == null || spd < 2) && (thr == null || thr < 8) && rpm < 1200) return 'idle';
  if ((load != null && load >= 70) || (thr != null && thr >= 50)) return 'load';
  if ((spd ?? 0) >= 25 && (thr == null || thr < 35) && (load == null || load < 70)) return 'cruise';
  return 'other';
}

// ---------- helpers ----------
const vals = (rows, ch) => rows.map((r) => r[ch]).filter((v) => v != null && Number.isFinite(v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const trim = (rows, b) => {
  const out = [];
  for (const r of rows) {
    const s = r[`stft${b}`], l = r[`ltft${b}`];
    if (s == null && l == null) continue;
    out.push((s ?? 0) + (l ?? 0));
  }
  return out;
};
const fmt = (v, dp = 1) => (v == null ? '—' : v.toFixed(dp));
const sign = (v) => (v > 0 ? '+' : '') + v.toFixed(1);

function medianDt(rows) {
  const d = [];
  for (let i = 1; i < rows.length; i++) { const x = rows[i].t - rows[i - 1].t; if (x > 0 && x < 10) d.push(x); }
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : null;
}

// Count crossings of 0.45 V for a channel within contiguous runs of rows.
function switching(rows, ch) {
  let crossings = 0, dur = 0, prev = null, prevT = null, n = 0;
  for (const r of rows) {
    const v = r[ch];
    if (v == null) continue;
    n++;
    if (prevT != null) {
      const dt = r.t - prevT;
      if (dt > 0 && dt < 3) {
        dur += dt;
        if ((prev < 0.45) !== (v < 0.45)) crossings++;
      }
    }
    prev = v; prevT = r.t;
  }
  return { hz: dur > 0 ? crossings / 2 / dur : null, crossings, dur, n };
}

// ---------- Analysis ----------
// rows: [{ t (seconds), rpm, coolant, ... }]
// opts: { vehicle, dtcs: ['P0171', ...], minSamples }
export function analyze(rows, { vehicle, dtcs = [], minSamples = 8 } = {}) {
  const R = rangesFor(vehicle);
  rows = rows.filter((r) => r && r.t != null).sort((a, b) => a.t - b.t);
  const by = Object.fromEntries(Object.keys(STATES).map((k) => [k, []]));
  for (const r of rows) { const s = stateOf(r, R); if (s) by[s].push(r); }
  const enough = (st) => by[st].length >= minSamples;
  const dt = medianDt(rows);
  const codes = new Set(dtcs.map((c) => String(c).toUpperCase()));
  const has = (...cs) => cs.filter((c) => codes.has(c));

  const checks = [];
  const check = (id, state, label, value, range, unit, dp = 1, statusFn) => {
    if (value == null) return;
    const status = statusFn ? statusFn(value) : value < range[0] || value > range[1] ? 'warn' : 'ok';
    checks.push({ id, state, label, value, display: fmt(value, dp), range, rangeText: Array.isArray(range) ? `${fmt(range[0], dp)} to ${fmt(range[1], dp)}` : range, unit, status });
  };

  // Gather per-state numbers.
  const idle = by.idle, cruise = by.cruise, load = by.load;
  const warmDriving = [...by.cruise, ...by.load, ...by.other, ...by.idle];
  const m = {
    idleRpm: mean(vals(idle, 'rpm')), idleRpmStd: std(vals(idle, 'rpm')),
    idleMaf: mean(vals(idle, 'maf')), idleLoad: mean(vals(idle, 'load')), idleTiming: mean(vals(idle, 'timing')),
    idleV: mean(vals(idle, 'voltage')), runV: mean(vals([...idle, ...cruise, ...load, ...by.other], 'voltage')), offV: mean(vals(by.off, 'voltage')),
    coolMax: Math.max(...vals(rows, 'coolant'), -Infinity),
    // Driving after 10+ minutes of running, whatever the coolant says (a
    // stuck-open thermostat keeps the engine "cold").
    coolWarmMin: (() => {
      const t0 = rows.find((r) => (r.rpm ?? 0) > 300)?.t;
      const v = vals(rows.filter((r) => (r.speed ?? 0) >= 25 && (r.rpm ?? 0) > 300 && ((r.runtime ?? 0) > 600 || (t0 != null && r.t - t0 > 600))), 'coolant');
      return v.length >= minSamples ? Math.min(...v) : null;
    })(),
    coolIdleMax: (() => { const v = vals(idle, 'coolant'); return v.length ? Math.max(...v) : null; })(),
    coolCruiseMax: (() => { const v = vals([...cruise, ...load], 'coolant'); return v.length ? Math.max(...v) : null; })(),
    runtimeMax: Math.max(...vals(rows, 'runtime'), -Infinity),
    iat: mean(vals(cruise, 'iat')), ambient: mean(vals(rows, 'ambient')),
    oilMax: Math.max(...vals(rows, 'oiltemp'), -Infinity),
  };
  const trims = {};
  for (const st of ['idle', 'cruise', 'load']) {
    for (const b of [1, 2]) {
      const t = trim(by[st], b);
      trims[`${st}${b}`] = t.length >= minSamples ? mean(t) : null;
      const l = vals(by[st], `ltft${b}`);
      trims[`${st}${b}L`] = l.length >= minSamples ? mean(l) : null;
    }
  }
  const banks = [1, 2].filter((b) => trims[`idle${b}`] != null || trims[`cruise${b}`] != null || trims[`load${b}`] != null);

  // Range checks.
  if (enough('idle')) {
    check('idle_rpm', 'idle', 'Idle speed', m.idleRpm, R.idleRpm, 'rpm', 0);
    check('idle_rpm_std', 'idle', 'Idle steadiness (rpm spread)', m.idleRpmStd, [0, R.idleRpmStd], 'rpm', 0);
    const mafR = R.mafIdlePerL.map((x) => x * R.displacementL);
    check('idle_maf', 'idle', 'MAF at idle', m.idleMaf, mafR, 'g/s', 2);
    check('idle_load', 'idle', 'Load at idle', m.idleLoad, R.idleLoad, '%', 0);
    check('idle_timing', 'idle', 'Timing at idle', m.idleTiming, R.idleTiming, '°', 1);
  }
  for (const st of ['idle', 'cruise', 'load']) {
    for (const b of banks) {
      const v = trims[`${st}${b}`];
      check(`trim_${st}_${b}`, st, `Total fuel trim bank ${b}`, v, [-R.trimTotal, R.trimTotal], '%', 1,
        (x) => (Math.abs(x) > R.trimTotal * 2 ? 'critical' : Math.abs(x) > R.trimTotal ? 'warn' : 'ok'));
    }
  }
  if (m.runV != null && (idle.length + cruise.length) >= minSamples) check('volt_run', 'cruise', 'Charging voltage (running)', m.runV, R.voltageRun, 'V', 2);
  if (m.idleV != null && idle.length >= minSamples) check('volt_idle', 'idle', 'Charging voltage at idle', m.idleV, [R.voltageRun[0] - 0.3, R.voltageRun[1]], 'V', 2);
  if (m.offV != null && by.off.length >= 3) check('volt_off', 'off', 'Battery voltage (engine off)', m.offV, [R.voltageOff, 13.0], 'V', 2, (x) => (x < 12.0 ? 'critical' : x < R.voltageOff ? 'warn' : 'ok'));
  if (m.coolCruiseMax != null || m.coolIdleMax != null) {
    const warmVals = vals(warmDriving, 'coolant');
    if (warmVals.length >= minSamples) check('coolant_run', 'cruise', 'Coolant temp (warm)', mean(warmVals), R.coolantRun, '°F', 0);
  }
  if (Number.isFinite(m.oilMax)) check('oil_max', 'load', 'Oil temp (max)', m.oilMax, [0, R.oilHot], '°F', 0);

  // O2 sensors at cruise (closed loop).
  const o2 = {};
  for (const b of [1, 2]) {
    const up = vals(cruise, `o2_b${b}s1`), dn = vals(cruise, `o2_b${b}s2`);
    if (up.length >= minSamples) {
      o2[b] = { upMin: Math.min(...up), upMax: Math.max(...up), upSw: switching(cruise, `o2_b${b}s1`), upStd: std(up) };
      check(`o2_range_${b}`, 'cruise', `Upstream O2 bank ${b} swing`, o2[b].upMax - o2[b].upMin, [R.o2Max - R.o2Min, 1.0], 'V', 2,
        () => (o2[b].upMax < R.o2Max || o2[b].upMin > R.o2Min ? 'warn' : 'ok'));
      if (dt != null && dt <= 0.5 && o2[b].upSw.hz != null) {
        check(`o2_sw_${b}`, 'cruise', `Upstream O2 bank ${b} switching`, o2[b].upSw.hz, [R.o2SwitchHz, 5], 'Hz', 2);
      }
    }
    if (dn.length >= minSamples && o2[b]) {
      o2[b].dnStd = std(dn);
      o2[b].dnMean = mean(dn);
      o2[b].ratio = o2[b].upStd ? o2[b].dnStd / o2[b].upStd : null;
      check(`cat_${b}`, 'cruise', `Catalyst bank ${b} (downstream / upstream activity)`, o2[b].ratio, [0, R.catRatio], '×', 2);
    }
  }

  // ---------- Pattern rules ----------
  const findings = [];
  const add = (f) => findings.push({ severity: 'warn', confidence: 'medium', parts: [], tests: [], evidence: [], ...f });
  const lean = (v) => v != null && v > R.trimTotal;
  const rich = (v) => v != null && v < -R.trimTotal;
  const bothBanks = banks.length === 2;

  // Fuel trims: vacuum leak vs MAF vs fuel delivery.
  const idleLean = banks.filter((b) => lean(trims[`idle${b}`]));
  const cruiseLean = banks.filter((b) => lean(trims[`cruise${b}`]));
  const loadLean = banks.filter((b) => lean(trims[`load${b}`]));
  const leanCodes = has('P0171', 'P0174');
  if (idleLean.length && banks.every((b) => trims[`idle${b}`] != null && trims[`cruise${b}`] != null)) {
    const improves = idleLean.every((b) => trims[`idle${b}`] - trims[`cruise${b}`] >= R.idleShiftFix);
    if (improves) {
      add({
        id: 'vacuum_leak', title: 'Vacuum leak (unmetered air)', severity: 'warn',
        confidence: idleLean.length === 2 || leanCodes.length ? 'high' : 'medium',
        summary: `Lean at idle${idleLean.length === 2 ? ' on both banks' : ` on bank ${idleLean[0]}`}, and it improves at cruise. Extra air that the MAF doesn't measure matters most at idle, when total airflow is low.`,
        evidence: idleLean.map((b) => `Bank ${b}: ${sign(trims[`idle${b}`])}% at idle → ${sign(trims[`cruise${b}`])}% at cruise`).concat(leanCodes.map((c) => `${c} stored`)),
        parts: ['intake_gasket', 'pcv', 'evap', 'throttle_body', 'egr'],
        tests: ['t_evap_smoke', 't_vacuum', 't_fuel_trims'],
        note: vehicle?.engine?.includes('3.8') ? 'On the 3.8 V6, the upper/lower intake gaskets, PCV hose and brake booster hose are the usual suspects.' : undefined,
      });
    }
  }
  if (cruiseLean.length && loadLean.length >= cruiseLean.length && banks.every((b) => trims[`load${b}`] != null)) {
    const worseAtLoad = loadLean.every((b) => trims[`load${b}`] >= (trims[`cruise${b}`] ?? 0) - 1);
    if (worseAtLoad && loadLean.length === banks.length) {
      add({
        id: 'fuel_delivery', title: 'Fuel delivery falling short under load', severity: 'warn',
        confidence: leanCodes.length || loadLean.every((b) => trims[`load${b}`] - (trims[`cruise${b}`] ?? 0) >= 4) ? 'medium' : 'low',
        summary: 'Lean on every bank, and as lean or worse as load rises. That points at fuel supply (pump, filter, regulator) or a MAF that under-reads at high airflow.',
        evidence: banks.map((b) => `Bank ${b}: ${sign(trims[`cruise${b}`] ?? 0)}% cruise, ${sign(trims[`load${b}`])}% high load`).concat(leanCodes.map((c) => `${c} stored`)),
        parts: ['fuel_pump', 'fuel_filter', 'maf', 'injectors'],
        tests: ['t_fuel_pressure', 't_fuel_trims'],
      });
    }
  }
  if (idleLean.length === banks.length && bothBanks && m.idleMaf != null && m.idleMaf < R.mafIdlePerL[0] * R.displacementL) {
    add({
      id: 'maf_low', title: 'MAF reading low (dirty or failing sensor)', severity: 'warn',
      confidence: 'medium',
      summary: `Both banks lean, and idle airflow reads ${fmt(m.idleMaf, 2)} g/s. A ${R.displacementL} L engine usually reads ${fmt(R.mafIdlePerL[0] * R.displacementL, 1)}–${fmt(R.mafIdlePerL[1] * R.displacementL, 1)} g/s.`,
      evidence: [`MAF at idle ${fmt(m.idleMaf, 2)} g/s`],
      parts: ['maf', 'air_filter'],
      tests: ['t_fuel_trims'],
      note: 'Try MAF cleaner on the sensing wire first. Check the intake boot for cracks after the MAF too.',
    });
  }
  const idleRich = banks.filter((b) => rich(trims[`idle${b}`]) || rich(trims[`cruise${b}`]));
  if (idleRich.length) {
    const richCodes = has('P0172', 'P0175');
    add({
      id: 'running_rich', title: idleRich.length === 2 ? 'Running rich on both banks' : `Running rich on bank ${idleRich[0]}`, severity: 'warn',
      confidence: richCodes.length || idleRich.length === 2 ? 'medium' : 'low',
      summary: idleRich.length === 2
        ? 'The computer is pulling fuel on both banks. Common causes: a leaking fuel pressure regulator, a leaking injector, a MAF over-reading, or a coolant sensor reading cold.'
        : 'Only one bank is rich, which points at that bank: a leaking injector, or an O2 sensor biased rich.',
      evidence: idleRich.map((b) => `Bank ${b}: ${sign(trims[`idle${b}`] ?? trims[`cruise${b}`])}%`).concat(richCodes.map((c) => `${c} stored`)),
      parts: idleRich.length === 2 ? ['fuel_pump', 'injectors', 'maf'] : ['injectors', `o2_up_${idleRich[0]}`],
      tests: ['t_fuel_pressure', 't_injector_balance', 't_fuel_trims'],
    });
  }
  if (bothBanks) {
    for (const st of ['idle', 'cruise']) {
      const a = trims[`${st}1`], b = trims[`${st}2`];
      if (a == null || b == null || Math.abs(a - b) < R.bankSplit) continue;
      const leanBank = a > b ? 1 : 2;
      add({
        id: 'bank_split', title: `Bank ${leanBank} leaner than bank ${3 - leanBank}`, severity: 'watch',
        confidence: 'medium',
        summary: `Trims differ by ${Math.abs(a - b).toFixed(1)} points at ${STATES[st].toLowerCase()}. A problem shared by both banks (MAF, fuel pressure) can't do that. Look for something on bank ${leanBank}: an intake gasket leak on that side, a clogged injector, or a lazy O2 sensor.`,
        evidence: [`Bank 1 ${sign(a)}%, bank 2 ${sign(b)}% at ${STATES[st].toLowerCase()}`],
        parts: ['intake_gasket', 'injectors', `o2_up_${leanBank}`],
        tests: ['t_evap_smoke', 't_injector_balance', 't_o2'],
        note: vehicle?.make === 'Ford' ? 'On Fords, bank 1 is the side with cylinder 1 (passenger side on the 3.8 V6).' : undefined,
      });
      break;
    }
  }

  // O2 sensors and catalyst.
  for (const b of Object.keys(o2)) {
    const s = o2[b];
    const stuck = s.upMax < 0.45 ? 'lean' : s.upMin > 0.45 ? 'rich' : null;
    if (stuck) {
      add({
        id: `o2_stuck_${b}`, title: `Upstream O2 bank ${b} stuck ${stuck}`, severity: 'warn', confidence: 'medium',
        summary: `At cruise the sensor stayed ${stuck === 'lean' ? 'below' : 'above'} 0.45 V the whole time (${fmt(s.upMin, 2)}–${fmt(s.upMax, 2)} V). Either the mixture really is ${stuck}, or the sensor is dead or biased. Compare it with the fuel trims.`,
        evidence: [`Range ${fmt(s.upMin, 2)}–${fmt(s.upMax, 2)} V`].concat(has(`P013${b === '1' ? '1' : '7'}`, 'P1131', 'P1151')),
        parts: [`o2_up_${b}`], tests: ['t_o2'],
      });
    } else if (s.upMax < R.o2Max || s.upMin > R.o2Min || (s.upSw.hz != null && dt != null && dt <= 0.5 && s.upSw.hz < R.o2SwitchHz)) {
      add({
        id: `o2_lazy_${b}`, title: `Upstream O2 bank ${b} slow or weak`, severity: 'watch',
        confidence: dt != null && dt <= 0.5 ? 'medium' : 'low',
        summary: `A healthy upstream sensor swings from under ${R.o2Min} V to over ${R.o2Max} V, several times a second. This one ranged ${fmt(s.upMin, 2)}–${fmt(s.upMax, 2)} V${s.upSw.hz != null && dt <= 0.5 ? ` at ${fmt(s.upSw.hz, 2)} switches/s` : ''}. Old sensors (over 100k miles) get lazy and slow the fuel control.`,
        evidence: [`Range ${fmt(s.upMin, 2)}–${fmt(s.upMax, 2)} V`, ...(dt != null && dt > 0.5 ? ['Samples were too far apart to measure switching speed. Show fewer gauges for a faster rate.'] : [])],
        parts: [`o2_up_${b}`], tests: ['t_o2'],
      });
    }
    if (s.ratio != null && s.ratio > R.catRatio) {
      const catCodes = has(b === '1' ? 'P0420' : 'P0430');
      add({
        id: `cat_${b}`, title: `Catalytic converter bank ${b} may be worn`, severity: 'watch',
        confidence: catCodes.length ? 'high' : 'low',
        summary: `The downstream O2 sensor moves ${Math.round(s.ratio * 100)}% as much as the upstream one. A good converter stores oxygen, so its downstream sensor stays steady (around 0.6–0.8 V). Rule out exhaust leaks before the sensor first.`,
        evidence: [`Downstream / upstream activity ${fmt(s.ratio, 2)}`].concat(catCodes.map((c) => `${c} stored`)),
        parts: [`cat_${b}`, `o2_down_${b}`, 'exhaust'], tests: ['t_o2', 't_backpressure'],
      });
    }
  }

  // Cooling.
  if (m.coolWarmMin != null && m.coolWarmMin < R.coolantRun[0] - 10) {
    add({
      id: 'thermostat_open', title: 'Thermostat stuck open', severity: 'warn',
      confidence: has('P0128').length ? 'high' : 'medium',
      summary: `Coolant dropped to ${fmt(m.coolWarmMin, 0)}°F while cruising, but it should hold ${R.coolantRun[0]}–${R.coolantRun[1]}°F. Airflow through the radiator overcools an engine whose thermostat won't close. Expect poor heat and mileage.`,
      evidence: [`Coolant min at cruise ${fmt(m.coolWarmMin, 0)}°F`].concat(has('P0128')),
      parts: ['thermostat'], tests: ['t_thermostat'],
    });
  } else if (has('P0128').length) {
    add({ id: 'thermostat_open', title: 'Thermostat slow to warm up (P0128)', severity: 'warn', confidence: 'medium', summary: 'Code P0128 means the engine took too long to reach temperature.', evidence: ['P0128 stored'], parts: ['thermostat'], tests: ['t_thermostat'] });
  }
  if (Number.isFinite(m.runtimeMax) && m.runtimeMax > 900 && !by.idle.length && !by.cruise.length && by.cold.length > minSamples) {
    add({ id: 'never_warm', title: 'Engine never reached operating temperature', severity: 'warn', confidence: 'medium', summary: `After ${Math.round(m.runtimeMax / 60)} minutes the coolant was still under ${R.warmCoolant}°F.`, evidence: [`Max coolant ${fmt(m.coolMax, 0)}°F`], parts: ['thermostat'], tests: ['t_thermostat'] });
  }
  if (m.coolIdleMax != null && m.coolIdleMax > R.coolantHot && (m.coolCruiseMax == null || m.coolCruiseMax < R.coolantHot - 5)) {
    add({
      id: 'hot_at_idle', title: 'Runs hot at idle, fine when moving', severity: m.coolIdleMax > R.coolantCritical ? 'critical' : 'warn', confidence: 'high',
      summary: `Coolant reached ${fmt(m.coolIdleMax, 0)}°F at idle but stays normal with airflow. That is the cooling fan's job, so check the fan, its relay and its connector first.`,
      evidence: [`Idle max ${fmt(m.coolIdleMax, 0)}°F`, m.coolCruiseMax != null ? `Driving max ${fmt(m.coolCruiseMax, 0)}°F` : null].filter(Boolean),
      parts: ['fan', 'coolant'], tests: ['t_thermostat', 't_cool_pressure'],
    });
  } else if (m.coolCruiseMax != null && m.coolCruiseMax > R.coolantHot) {
    add({
      id: 'hot_driving', title: 'Overheating while driving', severity: m.coolCruiseMax > R.coolantCritical ? 'critical' : 'warn', confidence: 'medium',
      summary: `Coolant reached ${fmt(m.coolCruiseMax, 0)}°F with airflow. Look at the radiator (clogged), the water pump, the thermostat (stuck shut), low coolant, or combustion gas in the coolant.`,
      evidence: [`Driving max ${fmt(m.coolCruiseMax, 0)}°F`],
      parts: ['radiator', 'water_pump', 'thermostat', 'coolant', 'head_gaskets'], tests: ['t_cool_pressure', 't_combustion_gas', 't_thermostat'],
    });
  }

  // Charging.
  const lowV = Math.min(m.runV ?? 99, idle.length >= minSamples ? (m.idleV ?? 99) + 0.3 : 99);
  if (m.runV != null && (idle.length + cruise.length) >= minSamples) {
    if (lowV < R.voltageRun[0]) {
      const idleOnly = (m.runV ?? 0) >= R.voltageRun[0];
      add({
        id: 'charging_low', title: idleOnly ? 'Charging voltage low at idle' : 'Charging voltage low', severity: Math.min(m.runV, m.idleV ?? 99) < 12.8 && !idleOnly ? 'critical' : 'warn', confidence: 'medium',
        summary: idleOnly
          ? `Voltage drops to ${fmt(m.idleV, 2)} V at idle but recovers when revved. That's typical of a worn alternator or a slipping belt. Check the belt and tensioner first.`
          : `Running voltage averaged ${fmt(m.runV, 2)} V; it should be ${R.voltageRun[0]}–${R.voltageRun[1]} V. Check the belt and tensioner, the alternator output, and corroded battery or ground cables.`,
        evidence: [`Running average ${fmt(m.runV, 2)} V`, m.idleV != null ? `Idle ${fmt(m.idleV, 2)} V` : null].filter(Boolean),
        parts: ['alternator', 'belt', 'battery', 'tensioner'], tests: ['t_charging', 't_battery'],
      });
    } else if (m.runV > R.voltageRun[1] + 0.2) {
      add({ id: 'charging_high', title: 'Overcharging', severity: 'warn', confidence: 'medium', summary: `Running voltage averaged ${fmt(m.runV, 2)} V. The alternator's built-in voltage regulator is probably failing, and this cooks batteries.`, evidence: [`${fmt(m.runV, 2)} V`], parts: ['alternator', 'battery'], tests: ['t_charging'] });
    }
  }
  if (m.offV != null && by.off.length >= 3 && m.offV < R.voltageOff) {
    add({ id: 'battery_low', title: 'Battery low at rest', severity: m.offV < 12.0 ? 'critical' : 'watch', confidence: 'medium', summary: `Engine-off voltage ${fmt(m.offV, 2)} V. A healthy, charged battery sits at 12.6 V or more.`, evidence: [`${fmt(m.offV, 2)} V engine off`], parts: ['battery'], tests: ['t_battery'] });
  }

  // Idle quality.
  if (enough('idle')) {
    const mf = has('P0300', 'P0301', 'P0302', 'P0303', 'P0304', 'P0305', 'P0306', 'P0307', 'P0308');
    if (m.idleRpmStd != null && m.idleRpmStd > R.idleRpmStd) {
      add({
        id: 'rough_idle', title: 'Unsteady idle', severity: 'watch', confidence: mf.length ? 'high' : 'low',
        summary: `Idle wanders ±${fmt(m.idleRpmStd, 0)} rpm. Causes: a misfire (plugs, wires, coil pack), a dirty idle air control valve, or a vacuum leak.`,
        evidence: [`rpm spread ${fmt(m.idleRpmStd, 0)}`].concat(mf.map((c) => `${c} stored`)),
        parts: ['plugs', 'plug_wires', 'coils', 'throttle_body', 'intake_gasket'], tests: ['t_misfire', 't_vacuum'],
      });
    }
    if (m.idleRpm != null && m.idleRpm > R.idleRpm[1]) {
      add({ id: 'high_idle', title: 'Idle speed high when warm', severity: 'watch', confidence: 'medium', summary: `Warm idle averaged ${fmt(m.idleRpm, 0)} rpm. Common causes: a sticking idle air control valve, a vacuum leak, or a coolant sensor reading cold.`, evidence: [`${fmt(m.idleRpm, 0)} rpm`], parts: ['throttle_body', 'intake_gasket'], tests: ['t_vacuum', 't_evap_smoke'] });
    }
    if (m.idleLoad != null && m.idleLoad > R.idleLoad[1]) {
      add({ id: 'idle_load', title: 'High load at idle', severity: 'watch', confidence: 'low', summary: `The engine works at ${fmt(m.idleLoad, 0)}% load just to idle. Look for a dragging accessory (A/C compressor, alternator, power steering), a restricted exhaust, or retarded timing.`, evidence: [`${fmt(m.idleLoad, 0)}% at idle`], parts: ['belt', 'ac_system', 'ps_pump', 'exhaust'], tests: ['t_vacuum', 't_backpressure'] });
    }
    if (m.idleTiming != null && m.idleTiming < R.idleTiming[0]) {
      add({ id: 'idle_timing', title: 'Low ignition timing at idle', severity: 'watch', confidence: 'low', summary: `Idle timing averaged ${fmt(m.idleTiming, 1)}°. The computer pulls timing for knock, for idle control, or for a faulty sensor.`, evidence: [`${fmt(m.idleTiming, 1)}° at idle`].concat(has('P0325')), parts: ['plugs', 'crank_sensor', 'cam_sensor'], tests: ['t_vacuum'] });
    }
  }

  // Code-only findings (no data pattern needed).
  const codeOnly = [
    [['P0300', 'P0301', 'P0302', 'P0303', 'P0304', 'P0305', 'P0306'], 'misfire', 'Misfire codes stored', ['plugs', 'plug_wires', 'coils', 'injectors'], ['t_misfire', 't_compression']],
    [['P0401', 'P0402', 'P1400', 'P1401'], 'egr', 'EGR / DPFE codes stored', ['egr'], ['t_vacuum']],
    [['P0442', 'P0455', 'P0456', 'P0457'], 'evap', 'EVAP leak codes stored', ['evap'], ['t_evap_smoke']],
    [['P0102', 'P0103', 'P1100', 'P1101'], 'maf_circuit', 'MAF circuit code stored', ['maf'], ['t_fuel_trims']],
    [['P0340', 'P0341'], 'cam_sensor', 'Camshaft sensor code stored', ['cam_sensor'], []],
    [['P0320', 'P0335'], 'crank_sensor', 'Crank sensor code stored', ['crank_sensor'], []],
    [['P0135', 'P0141', 'P0155', 'P0161'], 'o2_heater', 'O2 sensor heater code stored', ['o2_up_1', 'o2_up_2', 'o2_down_1', 'o2_down_2'], ['t_o2']],
  ];
  for (const [list, id, title, parts, tests] of codeOnly) {
    const hit = has(...list);
    if (!hit.length || findings.some((f) => f.id === id)) continue;
    add({ id, title, severity: 'warn', confidence: 'medium', summary: `Stored code${hit.length > 1 ? 's' : ''}: ${hit.join(', ')}.`, evidence: hit.map((c) => `${c} stored`), parts, tests });
  }
  if (leanCodes.length && !findings.some((f) => ['vacuum_leak', 'fuel_delivery', 'maf_low'].includes(f.id))) {
    add({ id: 'lean_code', title: `Lean code${leanCodes.length > 1 ? 's' : ''} stored (${leanCodes.join(', ')})`, severity: 'warn', confidence: 'medium', summary: 'The computer saw lean trims. Record warm idle plus a few minutes of steady cruise, and the app can tell a vacuum leak from a MAF or fuel problem.', evidence: leanCodes.map((c) => `${c} stored`), parts: ['intake_gasket', 'maf', 'fuel_pump', 'fuel_filter'], tests: ['t_evap_smoke', 't_fuel_pressure', 't_fuel_trims'] });
  }

  // Order: severity, then confidence.
  const SEV = { critical: 0, warn: 1, watch: 2 }, CONF = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || CONF[a.confidence] - CONF[b.confidence]);

  // What data is missing for a fuller diagnosis.
  const coverage = [];
  if (!enough('idle')) coverage.push('Let the engine idle fully warm (coolant over ' + R.warmCoolant + '°F) for 1–2 minutes, with no throttle.');
  if (!enough('cruise')) coverage.push('Drive at a steady 35–60 mph with light throttle for 1–2 minutes.');
  if (!enough('load')) coverage.push('Do one firm acceleration (over 50% throttle) to check fueling under load.');
  if (!rows.some((r) => r.o2_b1s1 != null)) coverage.push('Add the O2 sensor gauges to check the sensors and catalytic converters.');
  else if (dt != null && dt > 0.5) coverage.push('O2 switching speed needs 2+ updates per second. Show fewer gauges while you check the O2 sensors.');
  if (!rows.some((r) => r.stft1 != null || r.ltft1 != null)) coverage.push('Add the fuel trim gauges (STFT and LTFT, both banks).');

  return {
    ranges: R,
    samples: rows.length,
    sampleInterval: dt,
    stateCounts: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])),
    checks,
    findings,
    coverage,
  };
}

// Severity to record on a part when a finding is marked on the car.
export function flagSeverity(f) {
  if (f.confidence === 'low') return 'watch';
  if (f.confidence === 'medium' && f.severity === 'critical') return 'warn';
  return f.severity;
}
