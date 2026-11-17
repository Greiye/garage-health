// Standard OBD-II mode 01 PIDs we poll, their decoders, and the canonical
// channel names shared with CSV import so live and imported data look alike.
// Temperatures are stored in °F, speed in mph (US units).

const C2F = (c) => c * 9 / 5 + 32;

export const PIDS = {
  '04': { ch: 'load', name: 'Engine load', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '05': { ch: 'coolant', name: 'Coolant temp', unit: '°F', bytes: 1, f: ([a]) => C2F(a - 40) },
  '06': { ch: 'stft1', name: 'Short term fuel trim B1', unit: '%', bytes: 1, f: ([a]) => (a - 128) * 100 / 128 },
  '07': { ch: 'ltft1', name: 'Long term fuel trim B1', unit: '%', bytes: 1, f: ([a]) => (a - 128) * 100 / 128 },
  '08': { ch: 'stft2', name: 'Short term fuel trim B2', unit: '%', bytes: 1, f: ([a]) => (a - 128) * 100 / 128 },
  '09': { ch: 'ltft2', name: 'Long term fuel trim B2', unit: '%', bytes: 1, f: ([a]) => (a - 128) * 100 / 128 },
  '0B': { ch: 'map', name: 'Manifold pressure', unit: 'kPa', bytes: 1, f: ([a]) => a },
  '0C': { ch: 'rpm', name: 'Engine RPM', unit: 'rpm', bytes: 2, f: ([a, b]) => (a * 256 + b) / 4 },
  '0D': { ch: 'speed', name: 'Vehicle speed', unit: 'mph', bytes: 1, f: ([a]) => a * 0.621371 },
  '0E': { ch: 'timing', name: 'Timing advance', unit: '°', bytes: 1, f: ([a]) => a / 2 - 64 },
  '0F': { ch: 'iat', name: 'Intake air temp', unit: '°F', bytes: 1, f: ([a]) => C2F(a - 40) },
  '10': { ch: 'maf', name: 'MAF air flow', unit: 'g/s', bytes: 2, f: ([a, b]) => (a * 256 + b) / 100 },
  '11': { ch: 'throttle', name: 'Throttle position', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '14': { ch: 'o2_b1s1', name: 'O2 B1S1', unit: 'V', bytes: 2, f: ([a]) => a / 200 },
  '15': { ch: 'o2_b1s2', name: 'O2 B1S2', unit: 'V', bytes: 2, f: ([a]) => a / 200 },
  '18': { ch: 'o2_b2s1', name: 'O2 B2S1', unit: 'V', bytes: 2, f: ([a]) => a / 200 },
  '19': { ch: 'o2_b2s2', name: 'O2 B2S2', unit: 'V', bytes: 2, f: ([a]) => a / 200 },
  '1F': { ch: 'runtime', name: 'Run time', unit: 's', bytes: 2, f: ([a, b]) => a * 256 + b },
  '2F': { ch: 'fuel', name: 'Fuel level', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '33': { ch: 'baro', name: 'Barometric pressure', unit: 'kPa', bytes: 1, f: ([a]) => a },
  '42': { ch: 'voltage', name: 'Module voltage', unit: 'V', bytes: 2, f: ([a, b]) => (a * 256 + b) / 1000 },
  '46': { ch: 'ambient', name: 'Ambient temp', unit: '°F', bytes: 1, f: ([a]) => C2F(a - 40) },
  '5C': { ch: 'oiltemp', name: 'Oil temp', unit: '°F', bytes: 1, f: ([a]) => C2F(a - 40) },
  // More standard Mode 01 PIDs. Which ones a car answers shows after connect (PID 00/20/40 bitmaps).
  '0A': { ch: 'fuelpress', name: 'Fuel pressure (gauge)', unit: 'psi', bytes: 1, f: ([a]) => a * 3 * 0.145038 },
  '21': { ch: 'milDist', name: 'Distance with MIL on', unit: 'mi', bytes: 2, f: ([a, b]) => (a * 256 + b) * 0.621371 },
  '2C': { ch: 'egrCmd', name: 'Commanded EGR', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '2E': { ch: 'evapCmd', name: 'Commanded EVAP purge', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '30': { ch: 'warmups', name: 'Warm-ups since codes cleared', unit: '', bytes: 1, f: ([a]) => a },
  '31': { ch: 'clrDist', name: 'Distance since codes cleared', unit: 'mi', bytes: 2, f: ([a, b]) => (a * 256 + b) * 0.621371 },
  '43': { ch: 'absload', name: 'Absolute load', unit: '%', bytes: 2, f: ([a, b]) => ((a * 256 + b) * 100) / 255 },
  '44': { ch: 'lambdaCmd', name: 'Commanded air-fuel ratio (λ)', unit: 'λ', bytes: 2, f: ([a, b]) => (2 / 65536) * (a * 256 + b) },
  '45': { ch: 'relthrottle', name: 'Relative throttle', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '47': { ch: 'throttleB', name: 'Throttle position B', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '49': { ch: 'pedalD', name: 'Accelerator pedal D', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
  '4C': { ch: 'throttleCmd', name: 'Commanded throttle', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255 },
};

// Channels that change slowly. The poller reads these once every SLOW_EVERY
// cycles, so a basic ELM327 (about 5 to 10 requests per second) spends its time
// on the channels that move fast. See src/obd/budget.js.
export const SLOW = new Set(['coolant', 'iat', 'ltft1', 'ltft2', 'voltage', 'fuel', 'baro', 'ambient', 'oiltemp', 'transtemp', 'runtime',
  'milDist', 'warmups', 'clrDist', 'fuelpress']);

// Channels in display order, with health rules. Rules map a reading to a
// part key and a severity. "when" lets a rule apply only while running.
export const CHANNELS = {
  rpm: { name: 'Engine RPM', unit: 'rpm', dp: 0 },
  speed: { name: 'Speed', unit: 'mph', dp: 0 },
  coolant: { name: 'Coolant temp', unit: '°F', dp: 0, rules: [
    { gt: 235, sev: 'critical', parts: ['coolant', 'thermostat', 'radiator', 'water_pump', 'head_gaskets'], text: 'Coolant over 235°F (overheating)' },
    { gt: 222, sev: 'warn', parts: ['coolant', 'thermostat', 'radiator', 'fan'], text: 'Coolant running hot (over 222°F)' },
    { lt: 160, sev: 'watch', minRuntime: 900, parts: ['thermostat'], text: 'Coolant under 160°F after warm-up (thermostat stuck open?)' },
  ] },
  voltage: { name: 'Voltage', unit: 'V', dp: 2, rules: [
    { lt: 12.8, sev: 'warn', whenRunning: true, parts: ['alternator', 'battery', 'belt'], text: 'Charging voltage under 12.8 V while running' },
    { gt: 15.2, sev: 'warn', whenRunning: true, parts: ['alternator'], text: 'Charging voltage over 15.2 V (overcharging)' },
  ] },
  ltft1: { name: 'LTFT B1', unit: '%', dp: 1, rules: [
    { absGt: 20, sev: 'critical', parts: ['intake_gasket', 'maf', 'fuel_filter', 'fuel_pump', 'injectors', 'o2_up_1'], text: 'Long term fuel trim bank 1 beyond ±20%' },
    { absGt: 12, sev: 'warn', parts: ['intake_gasket', 'maf', 'o2_up_1'], text: 'Long term fuel trim bank 1 beyond ±12% (vacuum leak or MAF?)' },
  ] },
  ltft2: { name: 'LTFT B2', unit: '%', dp: 1, rules: [
    { absGt: 20, sev: 'critical', parts: ['intake_gasket', 'maf', 'fuel_filter', 'fuel_pump', 'injectors', 'o2_up_2'], text: 'Long term fuel trim bank 2 beyond ±20%' },
    { absGt: 12, sev: 'warn', parts: ['intake_gasket', 'maf', 'o2_up_2'], text: 'Long term fuel trim bank 2 beyond ±12% (vacuum leak or MAF?)' },
  ] },
  stft1: { name: 'STFT B1', unit: '%', dp: 1 },
  stft2: { name: 'STFT B2', unit: '%', dp: 1 },
  iat: { name: 'Intake air', unit: '°F', dp: 0 },
  maf: { name: 'MAF', unit: 'g/s', dp: 2 },
  throttle: { name: 'Throttle', unit: '%', dp: 0 },
  load: { name: 'Load', unit: '%', dp: 0 },
  timing: { name: 'Timing', unit: '°', dp: 1 },
  map: { name: 'MAP', unit: 'kPa', dp: 0 },
  o2_b1s1: { name: 'O2 B1S1', unit: 'V', dp: 3 },
  o2_b1s2: { name: 'O2 B1S2', unit: 'V', dp: 3 },
  o2_b2s1: { name: 'O2 B2S1', unit: 'V', dp: 3 },
  o2_b2s2: { name: 'O2 B2S2', unit: 'V', dp: 3 },
  fuel: { name: 'Fuel level', unit: '%', dp: 0 },
  baro: { name: 'Baro', unit: 'kPa', dp: 0 },
  ambient: { name: 'Ambient', unit: '°F', dp: 0 },
  oiltemp: { name: 'Oil temp', unit: '°F', dp: 0, rules: [{ gt: 270, sev: 'warn', parts: ['oil'], text: 'Oil temp over 270°F' }] },
  transtemp: { name: 'Trans temp', unit: '°F', dp: 0, rules: [{ gt: 240, sev: 'warn', parts: ['trans_fluid'], text: 'Transmission temp over 240°F' }] },
  runtime: { name: 'Run time', unit: 's', dp: 0 },
  fuelpress: { name: 'Fuel pressure', unit: 'psi', dp: 0 },
  absload: { name: 'Absolute load', unit: '%', dp: 0 },
  lambdaCmd: { name: 'Commanded λ', unit: 'λ', dp: 3 },
  relthrottle: { name: 'Relative throttle', unit: '%', dp: 0 },
  throttleB: { name: 'Throttle B', unit: '%', dp: 0 },
  pedalD: { name: 'Pedal D', unit: '%', dp: 0 },
  throttleCmd: { name: 'Commanded throttle', unit: '%', dp: 0 },
  egrCmd: { name: 'Commanded EGR', unit: '%', dp: 0 },
  evapCmd: { name: 'EVAP purge', unit: '%', dp: 0 },
  milDist: { name: 'Miles with MIL on', unit: 'mi', dp: 0 },
  clrDist: { name: 'Miles since codes cleared', unit: 'mi', dp: 0 },
  warmups: { name: 'Warm-ups since clear', unit: '', dp: 0 },
};

// Evaluate rules for one sample. Returns [{ partKeys, sev, text, code }]
export function evaluate(sample, ctx = {}) {
  const hits = [];
  const running = (sample.rpm ?? ctx.rpm ?? 0) > 400;
  for (const [ch, def] of Object.entries(CHANNELS)) {
    const v = sample[ch];
    if (v == null || !def.rules) continue;
    for (const r of def.rules) {
      if (r.whenRunning && !running) continue;
      if (r.minRuntime && (sample.runtime ?? ctx.runtime ?? 0) < r.minRuntime) continue;
      const ok = (r.gt != null && v > r.gt) || (r.lt != null && v < r.lt) || (r.absGt != null && Math.abs(v) > r.absGt);
      if (ok) {
        hits.push({ parts: r.parts, sev: r.sev, text: r.text, code: `obd:${ch}:${r.gt ?? r.lt ?? r.absGt}` });
        break; // first (most severe) rule per channel
      }
    }
  }
  return hits;
}
