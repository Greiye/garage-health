import { db, getSetting, setSetting } from '../data/db.js';
import { addFlag } from '../data/repo.js';
import { BluetoothTransport, normalizeMac, WebSerialTransport, WebBleTransport, DemoTransport, Elm327, Poller } from '../obd/elm327.js';
import { CHANNELS, evaluate } from '../obd/pids.js';
import { describeDtc, partsForDtc, dtcSeverity } from '../obd/dtc.js';
import { parseObdCsv, summarize, downsample } from '../obd/csvImport.js';
import { exportObdSessionCsv } from './csvExport.js';
import { esc, fmtDate, toast, modal, confirmDialog } from './util.js';

const DEFAULT_PIDS = ['0C', '0D', '05', '0F', '06', '07', '08', '09', '10', '11', '04', '0E', '14', '15', '18', '19', '1F', '42'];
const GAUGES = ['rpm', 'speed', 'coolant', 'voltage', 'ltft1', 'ltft2', 'stft1', 'stft2', 'iat', 'maf', 'throttle', 'load', 'timing', 'o2_b1s1', 'o2_b2s1', 'o2_b1s2', 'o2_b2s2'];

// Connection state survives tab switches.
const live = { autoTried: new Set(), elm: null, transport: null, poller: null, sample: {}, recording: null, status: 'disconnected', info: null, log: [], alerts: new Map() };

export async function renderObd(app, el) {
  const native = BluetoothTransport.available();
  const serial = !native && WebSerialTransport.available();
  const saved = native ? await savedAdapter(app.st.vehicle.id) : null;
  const sessions = await db.obdSessions.where({ vehicleId: app.st.vehicle.id }).reverse().sortBy('date');
  const dtcs = await db.dtcs.where({ vehicleId: app.st.vehicle.id }).toArray();
  const activeDtcs = dtcs.filter((d) => d.active);

  el.innerHTML = `
  <section class="card">
    <div class="sec-head"><h3>Live connection</h3><span class="status st-${live.status}">${esc(live.status)}</span></div>
    ${native ? '' : serial ? '<p class="muted small">PC: pair the Bluetooth adapter in Windows Settings first (it becomes a COM port), or plug in a USB adapter. Then pick its port. Bluetooth adapters usually show as "Standard Serial over Bluetooth link"; if two appear, try the first (outgoing) one.</p>' : '<p class="muted small">This browser can\'t reach serial adapters. Use Chrome or Edge on PC, or the Android app. You can still try the simulated adapter.</p>'}
    ${live.info ? `<p class="small muted">${esc(live.info.version)} · ${esc(live.info.protocol)} · ${live.info.supported.length} PIDs supported</p>` : ''}
    <div class="actions">
      ${live.status === 'connected' ? `
        <button class="btn" data-act="disconnect">Disconnect</button>
        <button class="btn ${live.recording ? 'danger' : 'primary'}" data-act="record">${live.recording ? `Stop recording (${live.recording.rows.length})` : 'Record session'}</button>
        <button class="btn" data-act="readdtc">Read codes</button>`
      : `${native ? `${saved ? `<button class="btn primary" data-act="reconnect">Connect ${esc(saved.name || saved.address)}</button>` : ''}<button class="btn ${saved ? '' : 'primary'}" data-act="scan">Paired adapters</button><button class="btn" data-act="manual">Enter address</button>` : ''}
        ${serial ? '<button class="btn primary" data-act="serial">Connect adapter (COM/USB)</button><select data-baud title="USB adapters: try 38400, then 115200 or 9600"><option>38400</option><option>115200</option><option>9600</option></select>' : ''}
        ${!native && WebBleTransport.available() ? '<button class="btn" data-act="ble">Connect BLE adapter</button>' : ''}
        <button class="btn ${native || serial ? '' : 'primary'}" data-act="demo">Demo adapter</button>`}
    </div>
    ${native && saved ? `<div class="row small saved-adapter"><span class="grow">Saved for this vehicle: <b>${esc(saved.name || 'Adapter')}</b> <span class="muted">${esc(saved.address)}</span></span><label class="tgl"><input type="checkbox" data-auto ${saved.auto !== false ? 'checked' : ''}> Auto-connect</label><button class="btn small" data-act="forget">Forget</button></div>` : ''}
    ${native && !saved && live.status !== 'connected' ? '<p class="muted small">Pair the adapter in Android Settings → Connected devices first (PIN is usually 1234 or 0000), then tap Paired adapters. The app remembers it for this vehicle and reconnects on its own.</p>' : ''}
    <div class="devices"></div>
    <div class="gauges">${GAUGES.map((ch) => gauge(ch)).join('')}</div>
    ${live.alerts.size ? `<ul class="list alerts">${[...live.alerts.values()].map((a) => `<li class="row-item"><span class="dot lv-${a.sev === 'critical' ? 'red' : a.sev === 'warn' ? 'orange' : 'yellow'}"></span>${esc(a.text)}</li>`).join('')}</ul>` : ''}
    <details class="small"><summary>Adapter log</summary><pre class="log">${esc(live.log.slice(-60).join('\n'))}</pre></details>
  </section>

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

  <section class="card">
    <h3>Sessions</h3>
    ${sessions.length ? `<ul class="list">${sessions.map((s) => `<li class="row-item" data-session="${s.id}"><div class="grow"><div>${esc(s.name)}</div><div class="muted small">${fmtDate(s.date.slice(0, 10))} · ${esc(s.source)} · ${s.rowCount} rows${s.alerts?.length ? ` · <span class="txt-orange">${s.alerts.length} alerts</span>` : ''}</div></div><span>›</span></li>`).join('')}</ul>` : '<p class="muted small">No sessions yet.</p>'}
  </section>`;

  el.onclick = (e) => onClick(app, el, e);
  const auto = el.querySelector('[data-auto]');
  if (auto) auto.onchange = () => saveAdapter(app.st.vehicle.id, { ...saved, auto: auto.checked });
  // Native auto-connect: once per app launch per vehicle, like OBD Fusion.
  const vid = app.st.vehicle.id;
  if (native && saved && saved.auto !== false && live.status === 'disconnected' && !live.autoTried.has(vid)) {
    live.autoTried.add(vid);
    connect(app, el, new BluetoothTransport(), saved.address, saved.name);
  }
  el.querySelector('[data-csv]').onchange = (e) => importCsv(app, el, e.target.files);
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
  const bad = live.alertsByCh?.[ch];
  return `<div class="gauge ${bad ? 'g-' + bad : ''}" data-g="${ch}"><span class="g-name">${esc(d.name)}</span><span class="g-val">${v == null ? '—' : v.toFixed(d.dp)}</span><span class="g-unit">${esc(d.unit)}</span></div>`;
}

function updateGauges(el) {
  for (const g of el.querySelectorAll('[data-g]')) {
    const ch = g.dataset.g;
    const v = live.sample[ch];
    g.querySelector('.g-val').textContent = v == null ? '—' : v.toFixed(CHANNELS[ch].dp);
    g.className = `gauge ${live.alertsByCh?.[ch] ? 'g-' + live.alertsByCh[ch] : ''}`;
  }
  const rec = el.querySelector('[data-act=record]');
  if (rec && live.recording) rec.textContent = `Stop recording (${live.recording.rows.length})`;
}

async function onClick(app, el, e) {
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
    if (act === 'record') {
      if (live.recording) {
        const r = live.recording;
        live.recording = null;
        await saveSession(app, { name: `Live session ${new Date().toLocaleString()}`, source: live.transport instanceof DemoTransport ? 'demo' : 'live', rows: r.rows });
        toast('Session saved');
        renderObd(app, el);
      } else {
        live.recording = { t0: Date.now(), rows: [] };
        renderObd(app, el);
      }
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
  renderObd(app, el);
  try {
    await transport.connect(address);
    if (transport instanceof BluetoothTransport) {
      const prev = await savedAdapter(app.st.vehicle.id);
      await saveAdapter(app.st.vehicle.id, { address: transport.address, name: name || (prev?.address === transport.address ? prev.name : '') || '', auto: prev?.auto !== false });
    }
    live.transport = transport;
    live.elm = new Elm327(transport, (l) => live.log.push(l));
    live.info = await live.elm.init();
    live.status = 'connected';
    live.alerts = new Map();
    live.poller = new Poller(live.elm, DEFAULT_PIDS, (s) => onSample(app, s));
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
  live.poller?.stop();
  try { await live.transport?.disconnect(); } catch {}
  live.status = 'disconnected';
  live.elm = live.poller = live.transport = live.info = null;
  if (live.recording?.rows.length) {
    await saveSession(app, { name: `Live session ${new Date().toLocaleString()}`, source: 'live', rows: live.recording.rows });
  }
  live.recording = null;
  renderObd(app, el);
}

let lastFlagWrite = 0;
async function onSample(app, s) {
  Object.assign(live.sample, s);
  if (live.recording) live.recording.rows.push({ ...s, t: (s.t - live.recording.t0) / 1000 });
  const hits = evaluate(live.sample);
  live.alertsByCh = {};
  for (const h of hits) {
    live.alerts.set(h.code, h);
    live.alertsByCh[h.code.split(':')[1]] = h.sev;
  }
  const el = document.querySelector('#panel .obd-view');
  if (el) updateGauges(el);
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

async function saveSession(app, { name, source, rows, mapping, unmatched }) {
  const stats = summarize(rows);
  // Evaluate rules on per-channel extremes to find problems in the log.
  const alerts = [];
  const seen = new Set();
  for (const r of rows) {
    for (const h of evaluate(r)) if (!seen.has(h.code)) { seen.add(h.code); alerts.push({ ...h, at: r.t }); }
  }
  return db.obdSessions.add({ vehicleId: app.st.vehicle.id, date: new Date().toISOString(), name, source, rowCount: rows.length, rows: downsample(rows), stats, alerts, mapping, unmatched });
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
  const chans = Object.keys(s.stats).filter((c) => CHANNELS[c]);
  const first = chans.includes('coolant') ? 'coolant' : chans[0];
  const html = `
    ${s.alerts?.length ? `<div class="callout warn"><b>${s.alerts.length} issue${s.alerts.length > 1 ? 's' : ''} found in this log</b><ul>${s.alerts.map((a) => `<li>${esc(a.text)} <span class="muted small">at ${a.at?.toFixed?.(0) ?? '?'} s</span></li>`).join('')}</ul><button class="btn small" data-apply>Flag these parts</button></div>` : '<p class="muted small">No out-of-range readings found.</p>'}
    <label>Chart<select data-ch>${chans.map((c) => `<option value="${c}" ${c === first ? 'selected' : ''}>${esc(CHANNELS[c].name)} (${esc(CHANNELS[c].unit)})</option>`).join('')}</select></label>
    <canvas class="chart" width="900" height="260"></canvas>
    <table class="tbl"><tr><th>Channel</th><th>Min</th><th>Avg</th><th>Max</th></tr>${chans.map((c) => { const st = s.stats[c], d = CHANNELS[c].dp; return `<tr><td>${esc(CHANNELS[c].name)}</td><td>${st.min.toFixed(d)}</td><td>${st.avg.toFixed(d)}</td><td>${st.max.toFixed(d)}</td></tr>`; }).join('')}</table>
    ${s.mapping ? `<details class="small"><summary>Column mapping</summary><ul>${Object.entries(s.mapping).map(([h, m]) => `<li>${esc(h)} → ${esc(CHANNELS[m.ch]?.name || m.ch)}</li>`).join('')}</ul>${s.unmatched?.length ? `<p class="muted">Not used: ${esc(s.unmatched.join(', '))}</p>` : ''}</details>` : ''}
    <div class="row between"><button class="btn danger" data-del>Delete session</button><span><button class="btn" data-export>Export CSV</button> <button class="btn" data-close>Close</button></span></div>`;
  modal(s.name, html, {
    wide: true,
    onMount: (root, close) => {
      const cv = root.querySelector('canvas'), sel = root.querySelector('[data-ch]');
      const draw = () => drawChart(cv, s.rows, sel.value);
      if (sel) { sel.onchange = draw; draw(); }
      root.querySelector('[data-export]').onclick = () => exportObdSessionCsv(app.st, s);
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
