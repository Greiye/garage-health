// Polling budget for a basic ELM327.
//
// A cheap ELM327 clone on a 2001-era bus (J1850 PWM on the Mustang) answers
// about 5 to 10 requests per second, whatever the app asks for. Every PID we
// add slows every other PID down, so the PID list per vehicle is planned
// against that budget:
//   fast channels are read every cycle,
//   slow channels (src/obd/pids.js SLOW) once every SLOW_EVERY cycles,
//   adapter voltage (ATRV) counts as a slow channel.
// The adapter's real speed is measured while polling and saved per vehicle on
// this device, so the estimate matches the adapter in use.

import { SLOW } from './pids.js';

export const SLOW_EVERY = 5;
export const DEFAULT_RPS = 8; // requests per second for an unmeasured basic ELM327
export const MAX_FAST_PERIOD = 2; // s: refuse a pick where fast channels update slower than this
export const O2_MIN_HZ = 2; // the O2 switching check needs this many readings per second

export const isSlow = (ch) => SLOW.has(ch);

// channels: canonical channel names to poll (voltage included if wanted).
// rps: adapter requests per second (measured or DEFAULT_RPS).
export function estimate(channels, rps = DEFAULT_RPS) {
  const uniq = [...new Set(channels)];
  const fast = uniq.filter((c) => !isSlow(c));
  const slow = uniq.filter((c) => isSlow(c));
  const units = fast.length + slow.length / SLOW_EVERY; // requests per cycle, on average
  const r = Math.max(1, rps || DEFAULT_RPS);
  const cycle = units / r; // seconds per cycle
  return {
    fast, slow, units, rps: r,
    fastPeriod: cycle, // seconds between updates of a fast channel
    slowPeriod: cycle * SLOW_EVERY,
    fastHz: cycle ? 1 / cycle : r,
    ok: cycle <= MAX_FAST_PERIOD,
    o2Ok: !fast.some((c) => c.startsWith('o2_b')) || (cycle ? 1 / cycle : r) >= O2_MIN_HZ,
    maxUnits: MAX_FAST_PERIOD * r,
  };
}

// Which items to request on cycle n. items: [{ ch, ... }]. Cycle 0 reads all.
export function dueOnCycle(items, n) {
  return items.filter((it) => !isSlow(it.ch) || n % SLOW_EVERY === 0);
}

export const fmtPeriod = (s) => (s < 1 ? `${(1 / s).toFixed(1)}× / s` : `every ${s.toFixed(s < 10 ? 1 : 0)} s`);
