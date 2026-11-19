// Bar-gauge scales: range and colored zones for each channel, built from the
// vehicle's healthy ranges so every car gets its own bands.
// Zone colors: red, orange, yellow, green, or n (neutral, no judgement).

// Gauge ranges are set for real driving, not the PID's full encodable span
// (-40..419°F etc.). Temperatures start at the coldest the car will see
// (R.climateLow, 20°F for Las Vegas); everything else spans what a healthy or
// failing engine can actually read, so the needle uses the whole dial.
export function scaleFor(ch, R) {
  const redline = R.redline ?? 6500;
  const cr = R.coolantRun || [185, 220];
  const v = R.voltageRun || [13.3, 14.8];
  const lo = R.climateLow ?? 20; // °F, coldest morning for this car
  const hi = R.climateHigh ?? 120; // °F, hottest afternoon
  const hot = R.coolantHot ?? 225, crit = R.coolantCritical ?? 240;
  const idle = R.idleRpm || [550, 900];
  const maf = Math.ceil((42 * (R.displacementL || 2.5)) / 10) * 10; // WOT airflow ≈ 40 g/s per litre
  const pct = [0, 100, [[0, 100, 'n']]];
  const S = {
    rpm: [0, redline + 500, [[0, idle[0] - 100, 'yellow'], [idle[0] - 100, redline - 700, 'green'], [redline - 700, redline, 'orange'], [redline, redline + 500, 'red']]],
    speed: [0, R.vmax ?? 120, [[0, R.vmax ?? 120, 'n']]],
    // Cold engine is normal at start-up, so cold reads neutral, not orange.
    coolant: [lo, 260, [[lo, cr[0], 'n'], [cr[0], cr[1], 'green'], [cr[1], hot, 'yellow'], [hot, crit, 'orange'], [crit, 260, 'red']]],
    voltage: [10, 16, [[10, 11.8, 'red'], [11.8, 12.4, 'orange'], [12.4, v[0], 'yellow'], [v[0], v[1], 'green'], [v[1], 15.2, 'orange'], [15.2, 16, 'red']]],
    // Intake air runs ambient + 10..50°F; heat-soaked over 160°F costs power and invites knock.
    iat: [lo, 200, [[lo, 140, 'green'], [140, 160, 'yellow'], [160, 180, 'orange'], [180, 200, 'red']]],
    ambient: [lo, hi, [[lo, hi, 'n']]],
    oiltemp: [lo, 300, [[lo, 150, 'n'], [150, R.oilHot ?? 260, 'green'], [R.oilHot ?? 260, 275, 'orange'], [275, 300, 'red']]],
    transtemp: [lo, 280, [[lo, 100, 'n'], [100, 200, 'green'], [200, 240, 'orange'], [240, 280, 'red']]],
    fuel: [0, 100, [[0, 8, 'red'], [8, 15, 'orange'], [15, 100, 'green']]],
    timing: [-10, 45, [[-10, 0, 'orange'], [0, 45, 'n']]],
    maf: [0, maf, [[0, maf, 'n']]],
    throttle: pct,
    load: pct,
    absload: pct,
    relthrottle: pct,
    throttleB: pct,
    pedalD: pct,
    throttleCmd: pct,
    egrCmd: pct,
    evapCmd: pct,
    // Naturally aspirated: manifold pressure can't pass baro. Warm idle ≈ 30-40 kPa.
    map: [15, 105, [[15, 105, 'n']]],
    // Vegas valley ≈ 91-94 kPa; Mt Charleston ≈ 75; Death Valley ≈ 102.
    baro: [70, 105, [[70, 105, 'n']]],
    runtime: [0, 3600, [[0, 3600, 'n']]],
    // Returnless EEC-V rail runs ≈ 30-45 psi gauge.
    fuelpress: [0, 80, [[0, 25, 'red'], [25, 30, 'orange'], [30, 45, 'green'], [45, 55, 'orange'], [55, 80, 'red']]],
    lambdaCmd: [0.7, 1.3, [[0.7, 1.3, 'n']]],
  };
  const t = R.trimTotal ?? 10;
  for (const k of ['ltft1', 'ltft2', 'stft1', 'stft2']) {
    S[k] = [-25, 25, [[-25, -2 * t, 'red'], [-2 * t, -t, 'orange'], [-t, t, 'green'], [t, 2 * t, 'orange'], [2 * t, 25, 'red']]];
  }
  // Narrowband O2 reads 0.1-0.9 V and switches constantly, so no zones (the diagnostics judge switching).
  for (const k of ['o2_b1s1', 'o2_b2s1', 'o2_b1s2', 'o2_b2s2']) S[k] = [0, 1.0, [[0, 1.0, 'n']]];
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
