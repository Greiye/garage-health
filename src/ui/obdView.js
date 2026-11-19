import { db, getSetting, setSetting } from '../data/db.js';
import { addFlag } from '../data/repo.js';
import { BluetoothTransport, normalizeMac, setKeepAwake, WebSerialTransport, WebBleTransport, DemoTransport, Elm327, Poller, RecordingService } from '../obd/elm327.js';
import { applyKeepScreenOn } from './display.js';
import { CHANNELS, PIDS, evaluate } from '../obd/pids.js';
import { describeDtc, partsForDtc, dtcSeverity } from '../obd/dtc.js';
import { parseObdCsv, summarize, downsample } from '../obd/csvImport.js';
import { exportObdSessionCsv } from './csvExport.js';
import { analyze, rangesFor } from '../obd/diagnostics.js';
import { Screen, sustain, LIMITS } from '../obd/filter.js';
import { scaleFor, zoneGradient, needlePct, zoneAt } from '../obd/scales.js';
import { diagnosisHTML, onDiagClick } from './diagView.js';
import { esc, fmtDate, toast, modal, confirmDialog } from './util.js';
import { estimate, fmtPeriod, DEFAULT_RPS, MAX_FAST_PERIOD, O2_MIN_HZ, isSlow } from '../obd/budget.js';
import { TESTS, TEST_METRICS, METRICS, METRICS_V, summarizeSession, trendPoints, availableMetrics, metricRange } from '../obd/trends.js';
import { trendSvg } from './trendChart.js';
import { exportTrendsCsv } from './csvExport.js';
import { probeMode22, mode22Summary } from '../obd/mode22.js';

const GAUGES = ['rpm', 'speed', 'coolant', 'voltage', 'ltft1', 'ltft2', 'stft1', 'stft2', 'iat', 'maf', 'throttle', 'load', 'timing', 'o2_b1s1', 'o2_b2s1', 'o2_b1s2', 'o2_b2s2'];

// Dashboard config per vehicle: which gauges to show (and poll) and how often.
const RATES = [[0, 'Fastest'], [250, '4× / s'], [500, '2× / s'], [1000, '1× / s'], [2000, 'Every 2 s'], [5000, 'Every 5 s']];
const CH_PID = Object.fromEntries(Object.entries(PIDS).map(([pid, d]) => [d.ch, pid]));
const ALWAYS_PIDS = ['0C', '05', '1F']; // rpm, coolant, run time: needed to know running / warmed-up state
const PICKABLE = Object.keys(CHANNELS).filter((ch) => CH_PID[ch] || ch === 'voltage');
async function dashConfig(vehicleId) {
  return { gauges: GAUGES, rateMs: 0, fsStyle: 'cockpit', ...(await getSetting(`obdDash:${vehicleId}`, {})) };
}
async function saveDashConfig(vehicleId, cfg) {
  live.cfg = cfg;
  await setSetting(`obdDash:${vehicleId}`, { gauges: cfg.gauges, rateMs: cfg.rateMs, fsStyle: cfg.fsStyle });
  if (live.poller) { live.poller.setPids(pidsFor(cfg)); live.poller.setRate(cfg.rateMs); }
}
const pidsFor = (cfg) => [...ALWAYS_PIDS, ...cfg.gauges.filter((ch) => ch !== 'voltage').map((ch) => CH_PID[ch]).filter(Boolean)];
// Channels actually polled for a gauge pick: the always-read ones and adapter voltage included.
const polledChannels = (gauges) => [...new Set([...ALWAYS_PIDS.map((p) => PIDS[p].ch), 'voltage', ...gauges])];

// Measured adapter speed (requests per second) per vehicle, on this device only.
async function adapterRps(vehicleId) { return (await getSetting('obdSpeed', {}))[vehicleId] || null; }
async function saveAdapterRps(vehicleId, rps) {
  if (!(rps > 0.5 && rps < 60)) return;
  const all = { ...(await getSetting('obdSpeed', {})) };
  all[vehicleId] = Math.round(rps * 10) / 10;
  await setSetting('obdSpeed', all);
}
function budgetLine(gauges, rps) {
  const e = estimate(polledChannels(gauges), rps || DEFAULT_RPS);
  return `${rps ? `Adapter ≈ ${e.rps.toFixed(1)} requests/s` : `Basic ELM327 ≈ ${DEFAULT_RPS} requests/s (not measured yet)`} · fast gauges ${fmtPeriod(e.fastPeriod)} · slow ${fmtPeriod(e.slowPeriod)}${e.ok ? '' : ' · <span class="txt-orange">too many gauges</span>'}`;
}

// Connection state survives tab switches.
const live = { buf: [], diag: null, dtcCodes: [], autoTried: new Set(), elm: null, transport: null, poller: null, sample: {}, recording: null, status: 'disconnected', info: null, log: [], alerts: new Map(), screen: new Screen(), sustainState: new Map() };

export async function renderObd(app, el) {
  lastApp = app; lastEl = el;
  if (!stopHooked) { stopHooked = true; RecordingService.onStop(() => { if (lastApp && live.recording) finishRecording(lastApp, lastEl); }); }
  const native = BluetoothTransport.available();
  const serial = !native && WebSerialTransport.available();
  const saved = native ? await savedAdapter(app.st.vehicle.id) : null;
  live.cfg = await dashConfig(app.st.vehicle.id);
  live.R = rangesFor(app.st.vehicle);
  const sessions = await db.obdSessions.where({ vehicleId: app.st.vehicle.id }).reverse().sortBy('date');
  await backfillSummaries(app, sessions);
  live.rps = await adapterRps(app.st.vehicle.id);
  const m22 = app.st.vehicle.mode22;
  const dtcs = await db.dtcs.where({ vehicleId: app.st.vehicle.id }).toArray();
  const activeDtcs = dtcs.filter((d) => d.active);
  live.dtcCodes = activeDtcs.map((d) => d.code);
  if (live.buf.length) live.diag = analyze(live.buf, { vehicle: app.st.vehicle, dtcs: live.dtcCodes });

  el.innerHTML = `
  <section class="card">
    <div class="sec-head"><h3>Live connection</h3><span class="status st-${live.status}">${esc(live.status)}</span></div>
    ${native ? '' : serial ? '<p class="muted small">PC: pair the Bluetooth adapter in Windows Settings first (it becomes a COM port), or plug in a USB adapter. Then pick its port. Bluetooth adapters usually show as "Standard Serial over Bluetooth link"; if two appear, try the first (outgoing) one.</p>' : '<p class="muted small">This browser can\'t reach serial adapters. Use Chrome or Edge on PC, or the Android app. You can still try the simulated adapter.</p>'}
    ${live.info ? `<p class="small muted">${esc(live.info.version)} · ${esc(live.info.protocol)} · ${live.info.supported.length} PIDs supported</p>` : ''}
    <div class="actions">
      ${live.status === 'connected' ? `
        <button class="btn" data-act="disconnect">Disconnect</button>
        ${live.recording ? '' : `<select data-test title="Which test is this? Sessions of the same test are compared over time.">${Object.entries(TESTS).map(([k, t]) => `<option value="${k}" ${k === live.test ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`}
        <button class="btn ${live.recording ? 'danger' : 'primary'}" data-act="record">${live.recording ? `Stop recording ${esc(TESTS[live.recording.test]?.name || '')} (${live.recording.rows.length})` : 'Record session'}</button>
        <button class="btn" data-act="readdtc">Read codes</button>`
      : `${native ? `${saved ? `<button class="btn primary" data-act="reconnect">Connect ${esc(saved.name || saved.address)}</button>` : ''}<button class="btn ${saved ? '' : 'primary'}" data-act="scan">Paired adapters</button><button class="btn" data-act="manual">Enter address</button>` : ''}
        ${serial ? '<button class="btn primary" data-act="serial">Connect adapter (COM/USB)</button><select data-baud title="USB adapters: try 38400, then 115200 or 9600"><option>38400</option><option>115200</option><option>9600</option></select>' : ''}
        ${!native && WebBleTransport.available() ? '<button class="btn" data-act="ble">Connect BLE adapter</button>' : ''}
        <button class="btn ${native || serial ? '' : 'primary'}" data-act="demo">Demo adapter</button>`}
    </div>
    ${native && saved ? `<div class="row small saved-adapter"><span class="grow">Saved for this vehicle: <b>${esc(saved.name || 'Adapter')}</b> <span class="muted">${esc(saved.address)}</span></span><label class="tgl"><input type="checkbox" data-auto ${saved.auto !== false ? 'checked' : ''}> Auto-connect</label><button class="btn small" data-act="forget">Forget</button></div>` : ''}
    ${native && !saved && live.status !== 'connected' ? '<p class="muted small">Pair the adapter in Android Settings → Connected devices first (PIN is usually 1234 or 0000), then tap Paired adapters. The app remembers it for this vehicle and reconnects on its own.</p>' : ''}
    <div class="devices"></div>
    <div class="row dash-tools small">
      <button class="btn small" data-act="fullscreen">⛶ Full screen</button>
      <button class="btn small" data-act="gauges">Choose gauges (${live.cfg.gauges.length})</button>
      <label>Update <select data-rate>${RATES.map(([ms, l]) => `<option value="${ms}" ${ms === live.cfg.rateMs ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="muted" data-hz>${live.poller?.hz ? live.poller.hz.toFixed(1) + ' updates/s' : ''}</span>
    </div>
    <p class="muted small budget-line" data-budget>${budgetLine(live.cfg.gauges, live.poller?.rps || live.rps)}</p>
    <div class="gauges">${live.cfg.gauges.map((ch) => gauge(ch)).join('')}</div>
    ${live.alerts.size ? `<ul class="list alerts">${[...live.alerts.values()].map((a) => `<li class="row-item"><span class="dot lv-${a.sev === 'critical' ? 'red' : a.sev === 'warn' ? 'orange' : 'yellow'}"></span>${esc(a.text)}</li>`).join('')}</ul>` : ''}
    <div class="row small mode22"><span class="grow"><b>Ford extended PIDs (Mode 22):</b> ${esc(mode22Summary(m22))}${m22 ? ` <span class="muted">· checked ${fmtDate(m22.checkedAt.slice(0, 10))}</span>` : ''}</span>
      ${live.status === 'connected' && !live.recording ? `<button class="btn small" data-act="mode22">${m22 ? 'Check again' : 'Check car'}</button>` : ''}</div>
    ${m22 ? `<details class="small"><summary>Mode 22 replies (${m22.results.length})</summary><table class="tbl"><tr><th>Sent</th><th>Via</th><th>Reply</th><th>Means</th></tr>${m22.results.map((r) => `<tr><td>${esc(r.req)}</td><td>${esc(r.via)}</td><td><code>${esc(r.reply)}</code></td><td>${esc(M22_MEANS[r.verdict] || r.verdict)}</td></tr>`).join('')}</table></details>` : ''}
    <details class="small adapter-log" ${live.logOpen ? 'open' : ''}><summary>Adapter log <span class="muted">(${live.log.length})</span></summary>
      <div class="row small"><button class="btn small" data-act="logfs">⛶ Full screen</button><button class="btn small" data-act="logcopy">Copy</button></div>
      <pre class="log">${esc(live.log.slice(-60).join('\n'))}</pre></details>
  </section>

  ${live.buf.length || live.status === 'connected' ? `<section class="card" data-diag-card>
    <div class="sec-head"><h3>Diagnosis</h3><span class="muted small">live, last ${Math.max(1, Math.round(((live.buf.at(-1)?.t ?? 0) - (live.buf[0]?.t ?? 0)) / 60))} min</span><button class="btn small" data-act="rediag">Re-check</button></div>
    <div data-diag-body>${live.diag ? diagnosisHTML(app, live.diag, { compact: true }) : '<p class="muted small">Collecting data. The first diagnosis shows after about 15 seconds.</p>'}</div>
  </section>` : ''}

  <section class="card">
    <div class="sec-head"><h3>Trouble codes</h3>${live.status === 'connected' && activeDtcs.length ? '<button class="btn small danger" data-act="cleardtc">Clear codes</button>' : ''}</div>
    ${activeDtcs.length ? `<ul class="list">${activeDtcs.map((d) => `<li class="row-item"><span class="dot lv-${dtcSeverity(d.code) === 'critical' ? 'red' : 'orange'} ${dtcSeverity(d.code) === 'critical' ? 'blink' : ''}"></span><div class="grow"><b>${esc(d.code)}</b>${d.pending ? ' <span class="muted small">pending</span>' : ''}<div class="small">${esc(describeDtc(d.code))}</div><div class="muted small">First seen ${fmtDate(d.firstSeen?.slice(0, 10))} · ${partsForDtc(d.code).length ? 'Lights up: ' + esc(partsForDtc(d.code).map((k) => app.st.parts.find((p) => p.key === k)?.name).filter(Boolean).join(', ')) : 'No part mapping'}</div></div><button class="btn small" data-dtc-off="${d.id}">Mark fixed</button></li>`).join('')}</ul>` : '<p class="muted small">No active codes recorded.</p>'}
    <form class="row" data-manual-dtc><input name="code" placeholder="Add code from another scanner, e.g. P0171" class="grow" pattern="[PCBUpcbu][0-9A-Fa-f]{4}"><button class="btn">Add</button></form>
    ${dtcs.filter((d) => !d.active).length ? `<details class="small"><summary>Past codes (${dtcs.filter((d) => !d.active).length})</summary><ul>${dtcs.filter((d) => !d.active).map((d) => `<li>${esc(d.code)} · ${esc(describeDtc(d.code))} · ${fmtDate(d.firstSeen?.slice(0, 10))} → ${fmtDate(d.clearedAt?.slice(0, 10))}</li>`).join('')}</ul></details>` : ''}
  </section>

  <section class="card">
    <div class="sec-head"><h3>Import CSV log</h3></div>
    <p class="muted small">Export a data log from OBD Fusion or OBDroid (CSV) and pick it here. Columns are matched by name and converted to °F and mph.</p>
    <label class="file">Choose CSV files<input type="file" accept=".csv,text/csv,text/plain" multiple data-csv></label>
  </section>

  ${trendsCardHTML(sessions)}

  <section class="card">
    <h3>Sessions</h3>
    ${sessions.length ? `<ul class="list">${sessions.map((s) => `<li class="row-item" data-session="${s.id}"><div class="grow"><div>${esc(s.name)}</div><div class="muted small">${fmtDate(s.date.slice(0, 10))} · ${esc(TESTS[s.test || 'drive']?.name || s.test)} · ${esc(s.source)} · ${s.rowCount} rows${s.rows ? '' : ' · summary only'}${s.alerts?.length ? ` · <span class="txt-orange">${s.alerts.length} alerts</span>` : ''}</div></div><span>›</span></li>`).join('')}</ul>` : '<p class="muted small">No sessions yet.</p>'}
  </section>`;

  el.onclick = (e) => onClick(app, el, e);
  const lg = el.querySelector('.adapter-log');
  lg.ontoggle = () => { live.logOpen = lg.open; };
  el.querySelector('[data-rate]').onchange = (e) => saveDashConfig(app.st.vehicle.id, { ...live.cfg, rateMs: +e.target.value });
  const auto = el.querySelector('[data-auto]');
  if (auto) auto.onchange = () => saveAdapter(app.st.vehicle.id, { ...saved, auto: auto.checked });
  // Native auto-connect: once per app launch per vehicle, like OBD Fusion.
  const vid = app.st.vehicle.id;
  if (native && saved && saved.auto !== false && live.status === 'disconnected' && !live.autoTried.has(vid)) {
    live.autoTried.add(vid);
    connect(app, el, new BluetoothTransport(), saved.address, saved.name);
  }
  el.querySelector('[data-csv]').onchange = (e) => importCsv(app, el, e.target.files);
  const ts = el.querySelector('[data-test]');
  if (ts) ts.onchange = () => { live.test = ts.value; };
  bindTrends(app, el, sessions);
  el.querySelector('[data-manual-dtc]').onsubmit = async (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim().toUpperCase();
    if (!code) return;
    await recordDtcs(app, [code], []);
    e.target.reset();
    renderObd(app, el);
  };
}

function gauge(ch) {
  const d = CHANNELS[ch];
  const v = live.sample[ch];
  const sc = live.R ? scaleFor(ch, live.R) : null;
  const txt = v == null ? '—' : v.toFixed(d.dp);
  const bar = sc ? `<span class="gbar" style="background:${zoneGradient(sc)}"><i class="gneedle" style="left:${v == null ? 0 : needlePct(sc, v)}%" ${v == null ? 'hidden' : ''}><b class="gnv">${txt}</b></i><span class="gmin">${sc.min}</span><span class="gmax">${sc.max}</span></span>` : '';
  const range = sc ? `<span class="g-range">${fmtTick(sc.min)} – ${fmtTick(sc.max)}</span>` : '';
  return `<div class="gauge ${gaugeClass(ch, v)}" data-g="${ch}">${dial(sc, v)}<span class="g-name">${esc(d.name)}</span>${range}<span class="g-ann"></span><span class="g-val">${txt}</span><span class="g-unit">${esc(d.unit)}</span>${bar}</div>`;
}

// Round instrument dial: 270° sweep, colored zone ring, white ticks and needle.
const SWEEP = 135;
const dialAngle = (sc, v) => -SWEEP + (2 * SWEEP * needlePct(sc, v)) / 100;
const pt = (deg, r) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)].map((n) => n.toFixed(2)).join(' ');
const fmtTick = (n) => (Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${+n.toFixed(2)}`);
function dial(sc, v) {
  let ring = '', ticks = '';
  if (sc) {
    ring = sc.zones.map(([a, b, c]) => {
      const a0 = dialAngle(sc, a), a1 = dialAngle(sc, b);
      if (a1 - a0 < 0.5) return '';
      return `<path class="dz dz-${c}" d="M${pt(a0, 25)} A25 25 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1, 25)}"/>`;
    }).join('');
    for (let i = 0; i <= 20; i++) {
      const deg = -SWEEP + (2 * SWEEP * i) / 20;
      ticks += i % 5 ? `<path class="dt-m" d="M${pt(deg, 19.5)} L${pt(deg, 22.5)}"/>` : `<path class="dt" d="M${pt(deg, 16.5)} L${pt(deg, 22.5)}"/>`;
    }
  }
  const ang = sc && v != null ? dialAngle(sc, v) : -SWEEP;
  return `<svg class="gdial" viewBox="-31 -31 62 62" aria-hidden="true"><circle class="d-bezel" r="30"/><circle class="d-face" r="28"/>${ring}${ticks}<g class="dneedle" style="transform:rotate(${ang}deg)" ${sc && v != null ? '' : 'visibility="hidden"'}><path d="M-1.5 5 L-0.6 -23 L0.6 -23 L1.5 5 Z"/></g><circle class="d-hub" r="3.4"/></svg>`;
}

// Alert from the rules wins; otherwise the zone the needle sits in colors the tile.
function gaugeClass(ch, v) {
  const bad = live.alertsByCh?.[ch];
  if (bad) return 'g-' + bad;
  const sc = v != null && live.R ? scaleFor(ch, live.R) : null;
  const z = sc && zoneAt(sc, v);
  return z === 'red' ? 'g-critical' : z === 'orange' ? 'g-warn' : z === 'yellow' ? 'g-watch' : '';
}

function updateGauges(el) {
  const hz = live.poller?.hz ? live.poller.hz.toFixed(1) + ' updates/s' : '';
  for (const h of document.querySelectorAll('[data-hz]')) h.textContent = hz;
  for (const g of document.querySelectorAll('.obd-fs [data-g]' + (el ? ', #panel .obd-view [data-g]' : ''))) {
    const ch = g.dataset.g;
    const v = live.sample[ch];
    const txt = v == null ? '—' : v.toFixed(CHANNELS[ch].dp);
    g.querySelector('.g-val').textContent = txt;
    const n = g.querySelector('.gneedle');
    if (n) {
      n.hidden = v == null;
      if (v != null) { n.style.left = `${needlePct(scaleFor(ch, live.R), v)}%`; n.firstChild.textContent = txt; }
    }
    const dn = g.querySelector('.dneedle');
    const sc = dn && live.R ? scaleFor(ch, live.R) : null;
    if (dn) {
      if (sc && v != null) { dn.removeAttribute('visibility'); dn.style.transform = `rotate(${dialAngle(sc, v)}deg)`; }
      else dn.setAttribute('visibility', 'hidden');
    }
    g.className = `gauge ${gaugeClass(ch, v)}`;
  }
  const rec = el?.querySelector('[data-act=record]');
  if (rec && live.recording) rec.textContent = `Stop recording (${live.recording.rows.length})`;
}

async function onClick(app, el, e) {
  if (e.target.closest('[data-diag-card]') && live.diag && await onDiagClick(app, e, live.diag, { source: 'live data' })) return;
  const t = e.target.closest('[data-act],[data-session],[data-dev],[data-dtc-off]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    if (t.dataset.dtcOff) {
      await db.dtcs.update(+t.dataset.dtcOff, { active: 0, clearedAt: new Date().toISOString() });
      const d = await db.dtcs.get(+t.dataset.dtcOff);
      const flags = await db.flags.where({ vehicleId: app.st.vehicle.id }).filter((f) => f.active && f.code === `dtc:${d.code}`).toArray();
      for (const f of flags) await db.flags.update(f.id, { active: 0 });
      await app.refresh();
      return;
    }
    if (t.dataset.session) return openSession(app, +t.dataset.session);
    if (t.dataset.dev) return connect(app, el, new BluetoothTransport(), t.dataset.dev, t.dataset.name);
    if (act === 'scan') {
      const box = el.querySelector('.devices');
      box.innerHTML = '<p class="muted small">Loading paired devices…</p>';
      const devs = (await new BluetoothTransport().listPaired()).filter((d) => d.type !== 2); // skip BLE-only
      devs.sort((a, b) => looksObd(b) - looksObd(a));
      box.innerHTML = devs.length
        ? `<ul class="list">${devs.map((d) => `<li class="row-item" data-dev="${esc(d.address)}" data-name="${esc(d.name || '')}"><div class="grow">${esc(d.name || 'Unnamed')}${looksObd(d) ? ' <span class="muted small">· looks like OBD</span>' : ''}<div class="muted small">${esc(d.address)}</div></div><span>Connect ›</span></li>`).join('')}</ul>`
        : '<p class="muted small">No paired Bluetooth devices. Pair the adapter in Android Settings → Connected devices → Pair new device (PIN 1234 or 0000), then try again, or enter its address.</p>';
    }
    if (act === 'reconnect') {
      const sv = await savedAdapter(app.st.vehicle.id);
      if (sv) return connect(app, el, new BluetoothTransport(), sv.address, sv.name);
    }
    if (act === 'forget') {
      await saveAdapter(app.st.vehicle.id, null);
      return renderObd(app, el);
    }
    if (act === 'manual') {
      modal('Adapter Bluetooth address', `<form class="form"><label>Bluetooth address (Android Settings → Connected devices → adapter ⚙ → bottom of the page)<input name="mac" placeholder="11:33:77:54:00:34" required autocapitalize="characters" spellcheck="false"></label><div class="row end"><button class="btn primary" type="submit">Connect</button></div></form>`, {
        onSubmit: (fd) => {
          const mac = normalizeMac(fd.get('mac'));
          if (!mac) { toast('That is not a Bluetooth address. It should be 6 pairs like 11:33:77:54:00:34.', 6000); return false; }
          connect(app, el, new BluetoothTransport(), mac);
        },
      });
    }
    if (act === 'demo') return connect(app, el, new DemoTransport(), 'DEMO');
    if (act === 'ble') return connect(app, el, new WebBleTransport(), null);
    if (act === 'serial') return connect(app, el, new WebSerialTransport(), +(el.querySelector('[data-baud]')?.value || 38400));
    if (act === 'disconnect') return disconnect(app, el);
    if (act === 'fullscreen') return openFullscreen(app);
    if (act === 'logfs') return openLogFullscreen();
    if (act === 'logcopy') { try { await navigator.clipboard.writeText(live.log.join('\n')); toast('Log copied'); } catch { toast('Copy failed'); } return; }
    if (act === 'rediag') { lastDiag = 0; return updateDiag(app); }
    if (act === 'gauges') return chooseGauges(app, el);
    if (act === 'mode22') return checkMode22(app, el);
    if (act === 'record') {
      if (live.recording) return finishRecording(app, el);
      live.recording = { t0: Date.now(), rows: [], test: live.test || 'drive', slow: {} };
      startRecordingNotice();
      renderObd(app, el);
    }
    if (act === 'readdtc') {
      const { stored, pending } = await live.elm.readDtcs();
      await recordDtcs(app, stored, pending);
      toast(stored.length + pending.length ? `${stored.length} stored, ${pending.length} pending` : 'No trouble codes');
      await app.refresh();
    }
    if (act === 'cleardtc') {
      if (!(await confirmDialog('Clear all trouble codes and turn off the check engine light? This also resets readiness monitors, so the car may not pass an emissions test until it completes a drive cycle.', 'Clear codes'))) return;
      const ok = await live.elm.clearDtcs();
      if (ok) {
        const act2 = await db.dtcs.where({ vehicleId: app.st.vehicle.id }).filter((d) => d.active).toArray();
        for (const d of act2) await db.dtcs.update(d.id, { active: 0, clearedAt: new Date().toISOString() });
        const fl = await db.flags.where({ vehicleId: app.st.vehicle.id }).filter((f) => f.active && f.source === 'dtc').toArray();
        for (const f of fl) await db.flags.update(f.id, { active: 0 });
        toast('Codes cleared');
      } else toast('Adapter did not confirm the clear');
      await app.refresh();
    }
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 6000);
  }
}

// Saved adapter per vehicle, kept on this device only (a phone and a PC use different links).
async function savedAdapter(vehicleId) {
  const all = await getSetting('obdAdapters', {});
  if (all[vehicleId]) return all[vehicleId];
  const legacy = await getSetting('obdAddress');
  return legacy ? { address: legacy, auto: true } : null;
}
async function saveAdapter(vehicleId, v) {
  const all = { ...(await getSetting('obdAdapters', {})) };
  if (v) all[vehicleId] = v; else delete all[vehicleId];
  await setSetting('obdAdapters', all);
  if (!v) await setSetting('obdAddress', null);
}
const looksObd = (d) => (/obd|elm|v-?link|vpeak|vp\d|vgate|icar|konnwei|scan|car|327/i.test(d.name || '') ? 1 : 0);

async function connect(app, el, transport, address, name) {
  live.status = 'connecting';
  live.log = [];
  live.buf = [];
  live.screen.reset();
  live.sustainState.clear();
  live.diag = null;
  renderObd(app, el);
  try {
    await transport.connect(address);
    if (transport instanceof BluetoothTransport) {
      const prev = await savedAdapter(app.st.vehicle.id);
      await saveAdapter(app.st.vehicle.id, { address: transport.address, name: name || (prev?.address === transport.address ? prev.name : '') || '', auto: prev?.auto !== false });
    }
    live.transport = transport;
    live.elm = new Elm327(transport, logLine);
    live.info = await live.elm.init();
    live.status = 'connected';
    live.alerts = new Map();
    live.poller = new Poller(live.elm, pidsFor(live.cfg || await dashConfig(app.st.vehicle.id)), (s) => onSample(app, s), { rateMs: live.cfg?.rateMs || 0 });
    live.poller.start();
    // Read codes once on connect
    const { stored, pending } = await live.elm.readDtcs().catch(() => ({ stored: [], pending: [] }));
    await recordDtcs(app, stored, pending);
    await app.refresh();
  } catch (err) {
    live.status = 'error';
    toast(err.message || String(err), 7000);
    try { await transport.disconnect(); } catch {}
    renderObd(app, el);
  }
}

async function disconnect(app, el) {
  if (live.poller?.rps) await saveAdapterRps(app.st.vehicle.id, live.poller.rps);
  live.poller?.stop();
  try { await live.transport?.disconnect(); } catch {}
  live.status = 'disconnected';
  live.elm = live.poller = live.transport = live.info = null;
  if (live.recording?.rows.length) {
    stopRecordingNotice();
    await saveSession(app, { name: `${TESTS[live.recording.test]?.name || 'Live session'} ${new Date().toLocaleString()}`, source: 'live', rows: live.recording.rows, test: live.recording.test });
  }
  stopRecordingNotice();
  live.recording = null;
  renderObd(app, el);
}

// Ends the recording, from the Stop button or the notification.
let lastApp = null, lastEl = null, stopHooked = false, recTimer = null;
async function finishRecording(app, el) {
  const r = live.recording;
  if (!r) return;
  live.recording = null;
  stopRecordingNotice();
  await saveSession(app, { name: `${TESTS[r.test]?.name || 'Live session'} ${new Date().toLocaleString()}`, source: live.transport instanceof DemoTransport ? 'demo' : 'live', rows: r.rows, test: r.test });
  toast('Session saved');
  renderObd(app, el);
}
// Keeps the recording alive in the background and updates its notification every 5 s.
function startRecordingNotice() {
  RecordingService.start('0:00 · 0 rows');
  clearInterval(recTimer);
  recTimer = setInterval(() => {
    const r = live.recording;
    if (!r) return;
    const s = Math.round((Date.now() - r.t0) / 1000);
    RecordingService.start(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${r.rows.length} rows`);
  }, 5000);
}
function stopRecordingNotice() {
  clearInterval(recTimer);
  recTimer = null;
  RecordingService.stop();
}

let lastFlagWrite = 0;
let lastRpsSave = 0;
let lastDiag = 0;
function updateDiag(app) {
  if (!live.buf.length) return;
  lastDiag = Date.now();
  live.diag = analyze(live.buf, { vehicle: app.st.vehicle, dtcs: live.dtcCodes });
  const body = document.querySelector('#panel .obd-view [data-diag-body]');
  if (body) body.innerHTML = diagnosisHTML(app, live.diag, { compact: true });
}
async function onSample(app, s) {
  // Reject impossible readings (keep the last good value); alerts below need a sustained condition.
  const t = s.t / 1000;
  const good = {};
  for (const [k, v] of Object.entries(s)) {
    const x = live.screen.accept(k, v, t);
    if (x !== null || !(k in LIMITS)) good[k] = x;
  }
  Object.assign(live.sample, good);
  // Rolling buffer for the live diagnosis: last 15 minutes, times in seconds.
  live.buf.push({ ...live.sample, t });
  while (live.buf.length > 4000 || (live.buf.length && live.buf.at(-1).t - live.buf[0].t > 900)) live.buf.shift();
  if (Date.now() - lastDiag > 15000) updateDiag(app);
  if (live.recording) {
    // Slow channels are read every few cycles; carry their last raw value so
    // every row knows coolant, trims and voltage (needed for engine state).
    const rec = live.recording;
    for (const [k, v] of Object.entries(s)) if (isSlow(k)) rec.slow[k] = v;
    rec.rows.push({ ...rec.slow, ...s, t: (s.t - rec.t0) / 1000 });
  }
  if (live.poller?.rps && Date.now() - lastRpsSave > 30000) {
    lastRpsSave = Date.now();
    live.rps = live.poller.rps;
    saveAdapterRps(app.st.vehicle.id, live.poller.rps);
    const b = document.querySelector('#panel .obd-view [data-budget]');
    if (b) b.innerHTML = budgetLine(live.cfg.gauges, live.poller.rps);
  }
  const hits = sustain(live.sustainState, evaluate(live.sample), t);
  live.alertsByCh = {};
  for (const h of hits) {
    live.alerts.set(h.code, h);
    live.alertsByCh[h.code.split(':')[1]] = h.sev;
  }
  const el = document.querySelector('#panel .obd-view');
  if (el || document.querySelector('.obd-fs')) updateGauges(el);
  updateFsAlerts();
  // Persist live alerts to parts at most every 5 s.
  if (hits.length && Date.now() - lastFlagWrite > 5000) {
    lastFlagWrite = Date.now();
    let changed = false;
    for (const h of hits) {
      for (const key of h.parts) {
        const p = app.st.parts.find((x) => x.key === key);
        if (p) { await addFlag({ vehicleId: app.st.vehicle.id, partId: p.id, source: 'obd', severity: h.sev, text: h.text, code: h.code }); changed = true; }
      }
    }
    if (changed) app.refresh({ keepPanel: true });
  }
}

async function recordDtcs(app, stored, pending) {
  const vid = app.st.vehicle.id;
  const now = new Date().toISOString();
  for (const [code, isPending] of [...stored.map((c) => [c, false]), ...pending.map((c) => [c, true])]) {
    const ex = await db.dtcs.where({ vehicleId: vid, code }).filter((d) => d.active).first();
    if (ex) await db.dtcs.update(ex.id, { lastSeen: now, pending: isPending });
    else await db.dtcs.add({ vehicleId: vid, code, pending: isPending, active: 1, firstSeen: now, lastSeen: now });
    for (const key of partsForDtc(code)) {
      const p = app.st.parts.find((x) => x.key === key);
      if (p) await addFlag({ vehicleId: vid, partId: p.id, source: 'dtc', severity: isPending ? 'watch' : dtcSeverity(code), text: `${code} ${describeDtc(code)}`, code: `dtc:${code}` });
    }
  }
  await app.refresh({ keepPanel: true });
}

async function saveSession(app, { name, source, rows, mapping, unmatched, test = 'drive' }) {
  const stats = summarize(rows);
  // Evaluate rules on per-channel extremes to find problems in the log.
  const alerts = [];
  const seen = new Set();
  for (const r of rows) {
    for (const h of evaluate(r)) if (!seen.has(h.code)) { seen.add(h.code); alerts.push({ ...h, at: r.t }); }
  }
  const summary = summarizeSession(rows, test, app.st.vehicle);
  return db.obdSessions.add({ uid: newUid(), vehicleId: app.st.vehicle.id, date: new Date().toISOString(), name, source, test, summary, rowCount: rows.length, rows: downsample(rows), stats, alerts, mapping, unmatched });
}

async function importCsv(app, el, files) {
  for (const f of files) {
    try {
      const text = await f.text();
      const r = parseObdCsv(text, f.name);
      if (!r.rows.length) throw new Error(`${f.name}: no recognizable data columns (found ${r.headerCount} columns)`);
      const id = await saveSession(app, { name: f.name, source: r.source, rows: r.rows, mapping: r.mapping, unmatched: r.unmatched });
      toast(`Imported ${f.name}: ${r.rows.length} rows, ${Object.keys(r.mapping).length} channels`);
      await renderObd(app, el);
      openSession(app, id);
    } catch (err) {
      toast(err.message, 7000);
    }
  }
}

async function openSession(app, id) {
  const s = await db.obdSessions.get(id);
  const codes = (await db.dtcs.where({ vehicleId: app.st.vehicle.id }).toArray()).filter((d) => d.active).map((d) => d.code);
  const diag = analyze(s.rows || [], { vehicle: app.st.vehicle, dtcs: codes });
  const chans = Object.keys(s.stats || {}).filter((c) => CHANNELS[c]);
  const test = s.test || 'drive';
  const sm = s.summary?.metrics || {};
  const first = chans.includes('coolant') ? 'coolant' : chans[0];
  const html = `
    <label>Test<select data-retag ${s.rows ? '' : 'disabled title="The raw log is on the device that recorded it"'}>${Object.entries(TESTS).map(([k, t]) => `<option value="${k}" ${k === test ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <p class="muted small">${esc(TESTS[test]?.how || '')}</p>
    ${Object.keys(sm).length ? `<table class="tbl"><tr><th>Summary (${esc(TESTS[test]?.name || test)})</th><th>Value</th><th>Healthy</th><th>Rows</th></tr>${Object.entries(sm).map(([id, m]) => { const d = METRICS[id], rg = metricRange(id, app.st.vehicle); return `<tr><td>${esc(d?.label || id)}</td><td><b>${m.v.toFixed(d?.dp ?? 1)}</b> ${esc(d?.unit || '')}</td><td class="muted">${rg ? (!Number.isFinite(rg[0]) ? `under ${rg[1].toFixed(d.dp)}` : !Number.isFinite(rg[1]) ? `over ${rg[0].toFixed(d.dp)}` : `${rg[0].toFixed(d.dp)} to ${rg[1].toFixed(d.dp)}`) : ''}</td><td class="muted">${m.n}</td></tr>`; }).join('')}</table>` : `<p class="muted small">No ${esc(TESTS[test]?.name.toLowerCase() || '')} rows found for a summary.</p>`}
    ${s.rows ? '' : '<p class="callout">Summary only. The raw log stays on the device that recorded it.</p>'}
    ${s.rows ? `<section class="diag" data-diag-sess><h4>Diagnosis</h4>${diagnosisHTML(app, diag, { compact: true })}</section>` : ''}
    ${s.alerts?.length ? `<div class="callout warn"><b>${s.alerts.length} issue${s.alerts.length > 1 ? 's' : ''} found in this log</b><ul>${s.alerts.map((a) => `<li>${esc(a.text)} <span class="muted small">at ${a.at?.toFixed?.(0) ?? '?'} s</span></li>`).join('')}</ul><button class="btn small" data-apply>Flag these parts</button></div>` : '<p class="muted small">No out-of-range readings found.</p>'}
    ${s.rows ? `<label>Chart<select data-ch>${chans.map((c) => `<option value="${c}" ${c === first ? 'selected' : ''}>${esc(CHANNELS[c].name)} (${esc(CHANNELS[c].unit)})</option>`).join('')}</select></label>
    <canvas class="chart" width="900" height="260"></canvas>` : ''}
    ${chans.length ? '' : '<!--'}<table class="tbl"><tr><th>Channel</th><th>Min</th><th>Avg</th><th>Max</th></tr>${chans.map((c) => { const st = s.stats[c], d = CHANNELS[c].dp; return `<tr><td>${esc(CHANNELS[c].name)}</td><td>${st.min.toFixed(d)}</td><td>${st.avg.toFixed(d)}</td><td>${st.max.toFixed(d)}</td></tr>`; }).join('')}</table>${chans.length ? '' : '-->'}
    ${s.mapping ? `<details class="small"><summary>Column mapping</summary><ul>${Object.entries(s.mapping).map(([h, m]) => `<li>${esc(h)} → ${esc(CHANNELS[m.ch]?.name || m.ch)}</li>`).join('')}</ul>${s.unmatched?.length ? `<p class="muted">Not used: ${esc(s.unmatched.join(', '))}</p>` : ''}</details>` : ''}
    <div class="row between"><button class="btn danger" data-del>Delete session</button><span>${s.rows ? '<button class="btn" data-export>Export CSV</button> ' : ''}<button class="btn" data-close>Close</button></span></div>`;
  modal(s.name, html, {
    wide: true,
    onMount: (root, close) => {
      const dg = root.querySelector('[data-diag-sess]');
      if (dg) dg.onclick = (e) => onDiagClick(app, e, diag, { source: `log ${s.name}`, onDone: close });
      const cv = root.querySelector('canvas'), sel = root.querySelector('[data-ch]');
      const draw = () => drawChart(cv, s.rows, sel.value);
      if (sel && cv) { sel.onchange = draw; draw(); }
      const ex = root.querySelector('[data-export]');
      if (ex) ex.onclick = () => exportObdSessionCsv(app.st, s);
      root.querySelector('[data-retag]').onchange = async (e) => {
        await db.obdSessions.update(id, { test: e.target.value, summary: summarizeSession(s.rows || [], e.target.value, app.st.vehicle) });
        close();
        await renderObd(app, document.querySelector('#panel .obd-view') || lastEl);
        openSession(app, id);
      };
      root.querySelector('[data-del]').onclick = async () => { await db.obdSessions.delete(id); close(); app.refresh(); };
      const ap = root.querySelector('[data-apply]');
      if (ap) ap.onclick = async () => {
        for (const a of s.alerts) for (const key of a.parts) {
          const p = app.st.parts.find((x) => x.key === key);
          if (p) await addFlag({ vehicleId: app.st.vehicle.id, partId: p.id, source: 'obd', severity: a.sev, text: `${a.text} (log ${s.name})`, code: a.code });
        }
        toast('Parts flagged');
        close();
        app.refresh();
      };
    },
  });
}

function drawChart(cv, rows, ch) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 36;
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H);
  const pts = rows.filter((r) => r[ch] != null);
  if (pts.length < 2) return;
  const xs = pts.map((r) => r.t), ys = pts.map((r) => r[ch]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - pad * 1.5), Y = (y) => H - pad + 10 - ((y - y0) / (y1 - y0 || 1)) * (H - pad * 1.5);
  ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#333';
  ctx.fillStyle = css.getPropertyValue('--muted').trim() || '#888';
  ctx.font = '22px system-ui';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad, Y(v)); ctx.lineTo(W, Y(v)); ctx.stroke();
    ctx.fillText(v.toFixed(CHANNELS[ch].dp), 2, Y(v) - 4);
  }
  ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  pts.forEach((r, i) => (i ? ctx.lineTo(X(r.t), Y(r[ch])) : ctx.moveTo(X(r.t), Y(r[ch]))));
  ctx.stroke();
}

// ---------- Session tests and trends ----------
const newUid = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// Sessions saved before trends existed get their summary once (needs the raw rows).
async function backfillSummaries(app, sessions) {
  for (const s of sessions) {
    if (s.summary?.v === METRICS_V || !s.rows) continue;
    s.test ||= 'drive';
    s.summary = summarizeSession(s.rows, s.test, app.st.vehicle);
    // No new uid here: older sessions match across devices by vehicle, date and name.
    await db.obdSessions.update(s.id, { test: s.test, summary: s.summary });
  }
}

function trendsCardHTML(sessions) {
  const tests = Object.keys(TESTS).filter((t) => sessions.some((s) => (s.test || 'drive') === t && Object.keys(s.summary?.metrics || {}).length));
  if (!tests.length) return `<section class="card"><h3>Trends</h3><p class="muted small">Record or import sessions and tag each with a test (warm idle, steady cruise, 2,500 rpm hold...). Each test gets a trend chart, one point per session, so you can compare this year's idle with last year's.</p></section>`;
  const test = tests.includes(live.trendTest) ? live.trendTest : tests[0];
  const metrics = availableMetrics(sessions, test);
  const metric = metrics.includes(live.trendMetric) ? live.trendMetric : metrics[0];
  return `<section class="card" data-trends>
    <div class="sec-head"><h3>Trends</h3><button class="btn small" data-trend-csv>Export CSV</button></div>
    <div class="row small"><label>Test <select data-trend-test>${tests.map((t) => `<option value="${t}" ${t === test ? 'selected' : ''}>${esc(TESTS[t].name)}</option>`).join('')}</select></label>
      <label>Value <select data-trend-metric>${metrics.map((m) => `<option value="${m}" ${m === metric ? 'selected' : ''}>${esc(METRICS[m].label)}</option>`).join('')}</select></label></div>
    <div data-trend-chart></div>
  </section>`;
}

function bindTrends(app, el, sessions) {
  const card = el.querySelector('[data-trends]');
  if (!card) return;
  const tSel = card.querySelector('[data-trend-test]'), mSel = card.querySelector('[data-trend-metric]');
  const draw = () => {
    live.trendTest = tSel.value; live.trendMetric = mSel.value;
    const pts = trendPoints(sessions, tSel.value, mSel.value);
    const box = card.querySelector('[data-trend-chart]');
    box.innerHTML = trendSvg(pts, METRICS[mSel.value], metricRange(mSel.value, app.st.vehicle))
      + `<ul class="list small trend-list">${pts.slice().reverse().slice(0, 6).map((p) => `<li class="row-item" data-session="${p.id}"><span class="grow">${fmtDate(p.date.slice(0, 10))} <span class="muted">${esc(p.name)}</span></span><b>${p.v.toFixed(METRICS[mSel.value].dp)} ${esc(METRICS[mSel.value].unit)}</b></li>`).join('')}</ul>`;
  };
  tSel.onchange = () => {
    const ms = availableMetrics(sessions, tSel.value);
    mSel.innerHTML = ms.map((m) => `<option value="${m}">${esc(METRICS[m].label)}</option>`).join('');
    draw();
  };
  mSel.onchange = draw;
  card.querySelector('[data-trend-csv]').onclick = () => exportTrendsCsv(app.st, sessions);
  draw();
}

// ---------- Mode 22 check ----------
const M22_MEANS = { positive: 'Answered', negative: 'Understood, refused this ID', unsupported: 'Mode 22 not supported', none: 'No answer' };
async function checkMode22(app, el) {
  if (!live.elm) return;
  toast('Checking Mode 22… live data pauses for a few seconds', 4000);
  const wasPolling = !!live.poller?.running;
  await live.poller?.stop();
  let res;
  try {
    res = await probeMode22(live.elm);
  } finally {
    if (wasPolling && live.status === 'connected') {
      live.poller = new Poller(live.elm, pidsFor(live.cfg), (s) => onSample(app, s), { rateMs: live.cfg?.rateMs || 0 });
      live.poller.start();
    }
  }
  await db.vehicles.update(app.st.vehicle.id, { mode22: res });
  toast(res.answered ? 'The car answers Mode 22' : 'No Mode 22 answer from this car', 5000);
  await app.refresh();
}

// ---------- Gauge picker ----------
function chooseGauges(app, el) {
  const sup = live.info ? new Set(live.info.supported) : null;
  const on = new Set(live.cfg.gauges);
  const rps = live.poller?.rps || live.rps;
  const rows = PICKABLE.map((ch) => {
    const pid = ch === 'voltage' ? null : CH_PID[ch];
    const unsupported = sup && pid && !sup.has(pid);
    return `<label class="pick ${unsupported ? 'muted' : ''}"><input type="checkbox" name="g" value="${ch}" ${on.has(ch) ? 'checked' : ''}> ${esc(CHANNELS[ch].name)} <span class="muted small">${esc(CHANNELS[ch].unit)}${pid ? ` · PID ${pid}` : ' · adapter'}${isSlow(ch) ? ' · slow' : ''}${unsupported ? ' · not supported by this car' : ''}</span></label>`;
  }).join('');
  modal('Choose gauges', `<form class="form"><p class="muted small">Only the gauges you pick are polled. A basic ELM327 answers about 5 to 10 requests per second in total, so each extra gauge slows the others. Slow channels (coolant, trims, voltage, temps) are read every 5th pass. RPM, coolant and run time are always read for the health checks.${sup ? '' : ' Connect to see which PIDs this car supports.'}</p>
    <div class="budget" data-meter></div>
    <div class="pick-list">${rows}</div><div class="row end"><button class="btn" type="button" data-all>All</button><button class="btn" type="button" data-none>None</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    onMount: (w) => {
      const meter = () => {
        const picked = [...w.querySelectorAll('[name=g]:checked')].map((c) => c.value).filter((ch) => !(sup && CH_PID[ch] && !sup.has(CH_PID[ch])));
        const e = estimate(polledChannels(picked), rps || DEFAULT_RPS);
        const pct = Math.min(100, (e.units / e.maxUnits) * 100);
        w.querySelector('[data-meter]').innerHTML = `<div class="budget-bar"><i class="${e.ok ? (pct > 75 ? 'b-warn' : 'b-ok') : 'b-over'}" style="width:${pct.toFixed(0)}%"></i></div>
          <div class="small">${e.fast.length} fast + ${e.slow.length} slow channels · ${e.units.toFixed(1)} requests per pass at ${rps ? `${e.rps.toFixed(1)} req/s measured` : `${DEFAULT_RPS} req/s (typical, not measured yet)`}</div>
          <div class="small"><b>Fast gauges ${fmtPeriod(e.fastPeriod)}</b> · slow ${fmtPeriod(e.slowPeriod)}${e.o2Ok ? '' : ` · <span class="txt-orange">O2 switching check needs ${O2_MIN_HZ}× / s: pick fewer fast gauges while checking O2 sensors</span>`}</div>
          ${e.ok ? '' : `<div class="small txt-red">Too many for this adapter: fast gauges would update slower than every ${MAX_FAST_PERIOD} s. Remove some to save.</div>`}`;
        w.querySelector('[type=submit]').disabled = !e.ok;
      };
      w.querySelector('[data-all]').onclick = () => { w.querySelectorAll('[name=g]').forEach((c) => { c.checked = true; }); meter(); };
      w.querySelector('[data-none]').onclick = () => { w.querySelectorAll('[name=g]').forEach((c) => { c.checked = false; }); meter(); };
      w.querySelectorAll('[name=g]').forEach((c) => { c.onchange = meter; });
      meter();
    },
    onSubmit: async (fd) => {
      const picked = new Set(fd.getAll('g'));
      // Keep display order stable (the CHANNELS order).
      await saveDashConfig(app.st.vehicle.id, { ...live.cfg, gauges: PICKABLE.filter((ch) => picked.has(ch)) });
      renderObd(app, el);
    },
  });
}

// ---------- Full-screen dashboard ----------
async function openFullscreen(app) {
  document.querySelector('.obd-fs')?.remove();
  const fs = document.createElement('div');
  const fsStyle = ['cockpit', 'compact', 'bars', 'large'].includes(live.cfg.fsStyle) ? live.cfg.fsStyle : 'cockpit';
  fs.className = `obd-fs fs-${fsStyle}`;
  fs.innerHTML = `
    <div class="fs-bar"><b>${esc(app.st.vehicle.name)}</b><span class="status st-${live.status}">${esc(live.status)}</span><span class="muted small" data-hz></span><span class="grow"></span>
      <select data-rate>${RATES.map(([ms, l]) => `<option value="${ms}" ${ms === live.cfg.rateMs ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-style title="Layout">${[['cockpit', 'Cockpit'], ['compact', 'Compact'], ['bars', 'Bars'], ['large', 'Large']].map(([k, l]) => `<option value="${k}" ${k === fsStyle ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn small" data-exit>✕ Exit</button></div>
    <div class="fs-gauges">${live.cfg.gauges.map((ch) => gauge(ch)).join('')}</div>
    <ul class="fs-alerts"></ul>`;
  document.body.appendChild(fs);
  fs.querySelector('[data-rate]').onchange = (e) => saveDashConfig(app.st.vehicle.id, { ...live.cfg, rateMs: +e.target.value });
  const exit = async () => {
    fs.remove();
    document.removeEventListener('keydown', onKey);
    await applyKeepScreenOn();
    try { screen.orientation?.unlock?.(); } catch {}
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  };
  const onKey = (e) => { if (e.key === 'Escape') exit(); };
  document.addEventListener('keydown', onKey);
  fs.querySelector('[data-exit]').onclick = exit;
  fs.querySelector('[data-style]').onchange = async (e) => {
    await saveDashConfig(app.st.vehicle.id, { ...live.cfg, fsStyle: e.target.value });
    fs.className = `obd-fs fs-${e.target.value}`;
  };
  fs.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.contains(fs)) exit(); });
  try { await fs.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
  await setKeepAwake(true);
  updateGauges(null);
  updateFsAlerts();
}

function updateFsAlerts() {
  const ul = document.querySelector('.obd-fs .fs-alerts');
  if (!ul) return;
  ul.innerHTML = [...live.alerts.values()].slice(-4).map((a) => `<li><span class="dot lv-${a.sev === 'critical' ? 'red blink' : a.sev === 'warn' ? 'orange' : 'yellow'}"></span>${esc(a.text)}</li>`).join('');
}

// ---------- Adapter log ----------
function logLine(l) {
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  live.log.push(l.replace(/^> /, `${ts} > `));
  if (live.log.length > 3000) live.log.splice(0, live.log.length - 3000);
  const pre = document.querySelector('#panel .obd-view .adapter-log[open] pre.log');
  if (pre) pre.textContent = live.log.slice(-60).join('\n');
  const fs = document.querySelector('.log-fs pre');
  if (fs) {
    const atBottom = fs.scrollHeight - fs.scrollTop - fs.clientHeight < 40;
    fs.textContent = live.log.join('\n');
    if (atBottom) fs.scrollTop = fs.scrollHeight;
  }
}

function openLogFullscreen() {
  document.querySelector('.log-fs')?.remove();
  const ov = document.createElement('div');
  ov.className = 'obd-fs log-fs';
  ov.innerHTML = `<div class="fs-bar"><b>Adapter log</b><span class="muted small">${live.log.length} entries · newest at the bottom</span><span class="grow"></span>
    <button class="btn small" data-copy>Copy</button><button class="btn small" data-clear>Clear</button><button class="btn small" data-exit>✕ Exit</button></div>
    <pre class="log"></pre>`;
  document.body.appendChild(ov);
  const pre = ov.querySelector('pre');
  pre.textContent = live.log.join('\n');
  pre.scrollTop = pre.scrollHeight;
  const exit = async () => { ov.remove(); document.removeEventListener('keydown', onKey); if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} } };
  const onKey = (e) => { if (e.key === 'Escape') exit(); };
  document.addEventListener('keydown', onKey);
  ov.querySelector('[data-exit]').onclick = exit;
  ov.querySelector('[data-clear]').onclick = () => { live.log.length = 0; pre.textContent = ''; };
  ov.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(live.log.join('\n')); toast('Log copied'); } catch { toast('Copy failed'); } };
  ov.requestFullscreen?.().catch?.(() => {});
}
