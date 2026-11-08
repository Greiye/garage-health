// Keeps a single bad reading from raising an alert or skewing a diagnosis.
// A reading is rejected when it is outside the sensor's possible range, or when
// it changes faster than the sensor can physically change. Alerts then need the
// condition to hold for a set time (see sustain()).

export const LIMITS = {
  coolant: { min: -40, max: 260, rate: 5 }, // °F per second
  voltage: { min: 0, max: 18, rate: 1 }, // V per second
};
// Seconds a condition must hold before its alert shows, per channel.
export const HOLD_S = { coolant: 10, voltage: 5 };
const DEFAULT_HOLD = 3;
// After a gap this long, the next reading is taken as new (no rate check).
const RESET_GAP = 10;

// Stateful screen for a live stream: accept(ch, value, t) → value, or null if rejected.
export class Screen {
  constructor() { this.last = new Map(); this.rejected = {}; }
  reset() { this.last.clear(); this.rejected = {}; }
  accept(ch, v, t) {
    const L = LIMITS[ch];
    if (!L || v == null || !Number.isFinite(v)) return v ?? null;
    const prev = this.last.get(ch);
    const dt = prev ? t - prev.t : Infinity;
    const jump = dt > 0 && dt < RESET_GAP && Math.abs(v - prev.v) / dt > L.rate;
    if (v < L.min || v > L.max || jump) {
      this.rejected[ch] = (this.rejected[ch] || 0) + 1;
      return null;
    }
    this.last.set(ch, { v, t });
    return v;
  }
}

// Screen a finished set of rows (times in seconds, sorted). Returns new rows and counts.
export function cleanRows(rows) {
  const scr = new Screen();
  const out = rows.map((r) => {
    const o = { ...r };
    for (const ch of Object.keys(LIMITS)) if (o[ch] != null) o[ch] = scr.accept(ch, o[ch], o.t);
    return o;
  });
  return { rows: out, rejected: scr.rejected };
}

// state: Map(alertCode → time it first held). hits: alerts true on this sample.
// Returns only the hits that have held for their hold time.
export function sustain(state, hits, t) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    seen.add(h.code);
    const first = state.get(h.code) ?? t;
    state.set(h.code, first);
    const ch = h.code.split(':')[1];
    if (t - first >= (HOLD_S[ch] ?? DEFAULT_HOLD)) out.push(h);
  }
  for (const k of [...state.keys()]) if (!seen.has(k)) state.delete(k);
  return out;
}
