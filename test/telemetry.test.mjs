// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, dueOnCycle, SLOW_EVERY } from '../src/obd/budget.js';
import { classify, answered } from '../src/obd/mode22.js';
import { summarizeSession, trendPoints, trendsForPart } from '../src/obd/trends.js';
import { PIDS } from '../src/obd/pids.js';

test('budget: slow channels count 1/5, cap at 2 s per fast update', () => {
  const e = estimate(['rpm', 'speed', 'coolant', 'voltage', 'ltft1', 'ltft2', 'iat'], 8);
  assert.equal(e.fast.length, 2);
  assert.equal(e.units, 2 + 5 / SLOW_EVERY);
  assert.ok(e.ok);
  const big = estimate(Array.from({ length: 20 }, (_, i) => `x${i}`), 8);
  assert.equal(big.ok, false); // 20 fast PIDs at 8/s = 2.5 s per update
});

test('budget: O2 switching needs 2 updates/s', () => {
  assert.equal(estimate(['rpm', 'o2_b1s1', 'o2_b2s1'], 8).o2Ok, true);
  assert.equal(estimate(['rpm', 'speed', 'o2_b1s1', 'o2_b2s1', 'maf', 'stft1'], 8).o2Ok, false);
});

test('budget: slow items only every 5th cycle', () => {
  const items = [{ ch: 'rpm' }, { ch: 'coolant' }];
  assert.deepEqual(dueOnCycle(items, 0).map((i) => i.ch), ['rpm', 'coolant']);
  assert.deepEqual(dueOnCycle(items, 1).map((i) => i.ch), ['rpm']);
  assert.deepEqual(dueOnCycle(items, 5).map((i) => i.ch), ['rpm', 'coolant']);
});

test('new PIDs decode', () => {
  assert.equal(Math.round(PIDS['44'].f([0x80, 0x00]) * 1000) / 1000, 1); // λ 1.0
  assert.equal(Math.round(PIDS['0A'].f([100])), 44); // 300 kPa ≈ 43.5 psi
  assert.equal(Math.round(PIDS['31'].f([0, 100])), 62); // 100 km
});

test('mode 22 reply classes', () => {
  assert.equal(classify('62 11 00 4A', '1100').verdict, 'positive');
  assert.equal(classify('7F 22 31', '1100').verdict, 'negative');
  assert.equal(classify('7F 22 11 00 31', '1100').verdict, 'negative'); // Ford SCP echo
  assert.equal(classify('7F 22 11', '1100').verdict, 'unsupported');
  assert.equal(classify('NO DATA', '1100').verdict, 'none');
  assert.equal(classify('?', '1100').verdict, 'none');
  assert.equal(answered([{ verdict: 'none' }, { verdict: 'unsupported' }]), false);
  assert.equal(answered([{ verdict: 'none' }, { verdict: 'negative' }]), true);
});

const idleRows = (n, trim, rpm = 700) => Array.from({ length: n }, (_, i) => ({ t: i, rpm: rpm + (i % 2 ? 10 : -10), speed: 0, throttle: 2, coolant: 195, stft1: 1, ltft1: trim, stft2: 0, ltft2: trim - 1, maf: 4, voltage: 14.1 }));

test('idle summary ignores a single spike and non-idle rows', () => {
  const rows = idleRows(30, 8);
  rows[10] = { ...rows[10], coolant: 342 };
  rows.push(...Array.from({ length: 10 }, (_, i) => ({ t: 30 + i, rpm: 2400, speed: 60, throttle: 20, coolant: 200, ltft1: 30, stft1: 0 })));
  const s = summarizeSession(rows, 'idle', { engine: '3.8L V6' });
  assert.equal(s.metrics.idle_rpm.v, 700);
  assert.equal(s.metrics.idle_trim1.v, 9);
  assert.equal(s.metrics.max_coolant.v, 200);
  assert.equal(s.metrics.idle_trim1.n, 30);
});

test('trend points per test, oldest first; part trends', () => {
  const sessions = [
    { id: 1, date: '2026-11-10T10:00:00Z', test: 'idle', summary: summarizeSession(idleRows(20, 6), 'idle') },
    { id: 2, date: '2025-11-10T10:00:00Z', test: 'idle', summary: summarizeSession(idleRows(20, 2), 'idle') },
    { id: 3, date: '2026-11-11T10:00:00Z', test: 'drive', summary: summarizeSession(idleRows(20, 9), 'drive') },
  ];
  const p = trendPoints(sessions, 'idle', 'idle_trim1');
  assert.deepEqual(p.map((x) => x.v), [3, 7]);
  const t = trendsForPart(sessions, 'intake_gasket');
  assert.ok(t.some((x) => x.test === 'idle' && x.points.length === 2));
});

test('cold start warm-up time', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ t: i * 10, rpm: 900, coolant: 60 + i * 2.5, speed: 0, throttle: 2 }));
  const s = summarizeSession(rows, 'cold');
  assert.ok(Math.abs(s.metrics.warmup_s.v - 7.67) < 0.1); // 60 → 175°F at 2.5°F/10 s = 460 s
});

test('sync merge keeps local raw rows and local-only sessions', async () => {
  const { mergeSessions } = await import('../src/sync/mergeSessions.js');
  const local = [{ id: 1, uid: 'a', rows: [{ t: 0 }], vehicleId: 1 }, { id: 2, uid: 'b', rows: [{ t: 1 }], vehicleId: 1 }];
  const remote = [{ id: 7, uid: 'a', vehicleId: 1, summary: { metrics: {} } }, { id: 8, uid: 'c', vehicleId: 1 }];
  const m = mergeSessions(local, remote);
  assert.deepEqual(m.map((s) => s.uid).sort(), ['a', 'b', 'c']);
  assert.deepEqual(m.find((s) => s.uid === 'a').rows, [{ t: 0 }]);
  assert.equal(m.find((s) => s.uid === 'c').rows, undefined);
  assert.ok(m.every((s) => s.id === undefined));
  assert.equal(mergeSessions(local, undefined), local);
});
