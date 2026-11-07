// Bar-gauge scales: range and colored zones for each channel, built from the
// vehicle's healthy ranges so every car gets its own bands.
// Zone colors: red, orange, yellow, green, or n (neutral, no judgement).

export function scaleFor(ch, R) {
  const redline = R.redline ?? 6500;
  const cr = R.coolantRun || [185, 220];
  const v = R.voltageRun || [13.3, 14.8];
  const S = {
    rpm: [0, redline + 1000, [[0, 450, 'yellow'], [450, redline - 700, 'green'], [redline - 700, redline, 'orange'], [redline, redline + 1000, 'red']]],
    speed: [0, 140, [[0, 140, 'n']]],
    coolant: [-40, 260, [[-40, 40, 'red'], [40, cr[0] - 25, 'orange'], [cr[0] - 25, cr[0], 'yellow'], [cr[0], cr[1], 'green'], [cr[1], R.coolantHot ?? 225, 'yellow'], [R.coolantHot ?? 225, R.coolantCritical ?? 240, 'orange'], [R.coolantCritical ?? 240, 260, 'red']]],
    voltage: [10, 16, [[10, 11.8, 'red'], [11.8, 12.4, 'orange'], [12.4, v[0], 'yellow'], [v[0], v[1], 'green'], [v[1], 15.2, 'orange'], [15.2, 16, 'red']]],
    iat: [-40, 220, [[-40, -10, 'yellow'], [-10, 130, 'green'], [130, 160, 'yellow'], [160, 185, 'orange'], [185, 220, 'red']]],
    oiltemp: [-40, 300, [[-40, 40, 'red'], [40, 150, 'yellow'], [150, R.oilHot ?? 260, 'green'], [R.oilHot ?? 260, 275, 'orange'], [275, 300, 'red']]],
    transtemp: [-40, 280, [[-40, 40, 'yellow'], [40, 200, 'green'], [200, 240, 'orange'], [240, 280, 'red']]],
    fuel: [0, 100, [[0, 8, 'red'], [8, 15, 'orange'], [15, 100, 'green']]],
    timing: [-10, 50, [[-10, 0, 'orange'], [0, 50, 'n']]],
    maf: [0, Math.round(40 * (R.displacementL || 2.5)), [[0, Math.round(40 * (R.displacementL || 2.5)), 'n']]],
    throttle: [0, 100, [[0, 100, 'n']]],
    load: [0, 100, [[0, 100, 'n']]],
    map: [0, 110, [[0, 110, 'n']]],
    baro: [60, 110, [[60, 110, 'n']]],
    ambient: [-40, 130, [[-40, 130, 'n']]],
    runtime: [0, 3600, [[0, 3600, 'n']]],
  };
  const t = R.trimTotal ?? 10;
  for (const k of ['ltft1', 'ltft2', 'stft1', 'stft2']) {
    S[k] = [-25, 25, [[-25, -2 * t, 'red'], [-2 * t, -t, 'orange'], [-t, t, 'green'], [t, 2 * t, 'orange'], [2 * t, 25, 'red']]];
  }
  for (const k of ['o2_b1s1', 'o2_b2s1', 'o2_b1s2', 'o2_b2s2']) S[k] = [0, 1.1, [[0, 1.1, 'n']]];
  const s = S[ch];
  return s ? { min: s[0], max: s[1], zones: s[2] } : null;
}

const COLORS = { red: 'var(--red)', orange: 'var(--orange)', yellow: 'var(--yellow)', green: 'var(--green)', n: 'var(--accent)' };

// CSS gradient with hard color stops for a scale.
export function zoneGradient(sc) {
  const span = sc.max - sc.min;
  const stops = sc.zones.map(([a, b, c]) => {
    const p0 = ((a - sc.min) / span) * 100, p1 = ((b - sc.min) / span) * 100;
    return `${COLORS[c]} ${p0.toFixed(2)}% ${p1.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export const needlePct = (sc, v) => Math.max(0, Math.min(100, ((v - sc.min) / (sc.max - sc.min)) * 100));
export function zoneAt(sc, v) {
  const z = sc.zones.find(([a, b]) => v >= a && v < b) || (v < sc.min ? sc.zones[0] : sc.zones.at(-1));
  return z?.[2];
}
