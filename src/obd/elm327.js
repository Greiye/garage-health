import { Capacitor, registerPlugin } from '@capacitor/core';
import { PIDS } from './pids.js';
import { parseDtcResponse } from './dtc.js';

// Native Bluetooth Classic bridge: android/app/src/main/java/com/mike/garagehealth/ObdSerialPlugin.java
const ObdSerial = registerPlugin('ObdSerial');

// ---------- Transports ----------
// Android: Bluetooth Classic SPP via the app's own ObdSerial plugin — the same
// kind of link OBD Fusion / OBDroid use with ELM327 adapters.
export class BluetoothTransport {
  constructor() {
    this.address = null;
    this.buffer = '';
    this.waiter = null;
  }
  static available() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }
  plugin() { return ObdSerial; }
  /** Adapters already paired in Android Bluetooth settings. */
  async listPaired() {
    const { devices } = await ObdSerial.listPaired();
    return devices || [];
  }
  async connect(address) {
    address = normalizeMac(address);
    if (!address) throw new Error('Enter the adapter address as 6 pairs, e.g. 11:33:77:54:00:34');
    this.listener = await ObdSerial.addListener('data', ({ value }) => this.onData(value));
    this.dropListener = await ObdSerial.addListener('disconnected', () => { this.address = null; this.waiter?.reject?.(new Error('Adapter disconnected')); });
    try {
      await ObdSerial.connect({ address });
    } catch (e) {
      await this.removeListeners();
      throw e;
    }
    this.address = address;
  }
  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.includes('>') && this.waiter) {
      const out = this.buffer.slice(0, this.buffer.lastIndexOf('>'));
      this.buffer = '';
      const w = this.waiter;
      this.waiter = null;
      w.resolve(out);
    }
  }
  async send(cmd, timeout = 4000) {
    this.buffer = '';
    const done = new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      setTimeout(() => {
        if (this.waiter?.resolve === resolve) {
          this.waiter = null;
          reject(new Error(`Timeout on ${cmd}`));
        }
      }, timeout);
    });
    await ObdSerial.write({ value: cmd + '\r' });
    return done;
  }
  async removeListeners() {
    try { await this.listener?.remove(); } catch {}
    try { await this.dropListener?.remove(); } catch {}
    this.listener = this.dropListener = null;
  }
  async disconnect() {
    await this.removeListeners();
    try { await ObdSerial.disconnect(); } catch {}
    this.address = null;
  }
}

// Keep the screen on (dashboard mode). Uses the Wake Lock API where it exists,
// and the native window flag in the Android app.
let wakeLock = null;
export async function setKeepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); return; }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; return; }
  } catch {}
  if (BluetoothTransport.available()) { try { await ObdSerial.keepAwake({ on }); } catch {} }
}

// Accepts 11:33:77:54:00:34, 11-33-77-54-00-34, 113377540034 (any case).
export function normalizeMac(s) {
  const hex = String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex.match(/../g).join(':') : null;
}

// PC (Chrome/Edge): Web Serial. Works with USB ELM327 adapters, and with
// Bluetooth Classic adapters once paired in Windows (they appear as a COM port).
export class WebSerialTransport {
  static available() { return typeof navigator !== 'undefined' && 'serial' in navigator; }
  async connect(baudRate = 38400) {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });
    this.address = 'serial';
    this.buffer = '';
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    const dec = new TextDecoder();
    (async () => {
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.onData(dec.decode(value));
        }
      } catch {}
    })();
  }
  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.includes('>') && this.waiter) {
      const out = this.buffer.slice(0, this.buffer.lastIndexOf('>'));
      this.buffer = '';
      const w = this.waiter;
      this.waiter = null;
      w.resolve(out);
    }
  }
  async send(cmd, timeout = 4000) {
    this.buffer = '';
    const done = new Promise((resolve, reject) => {
      this.waiter = { resolve };
      setTimeout(() => { if (this.waiter?.resolve === resolve) { this.waiter = null; reject(new Error(`Timeout on ${cmd}`)); } }, timeout);
    });
    await this.writer.write(new TextEncoder().encode(cmd + '\r'));
    return done;
  }
  async disconnect() {
    try { await this.reader?.cancel(); this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.address = null;
  }
}

// PC/Android Chrome: Web Bluetooth for BLE (4.0+) ELM327 adapters such as
// OBDLink CX or Vgate iCar Pro BLE. Classic adapters use WebSerialTransport.
const BLE_PROFILES = [
  { service: 0xfff0, notify: 0xfff1, write: 0xfff2 },
  { service: 0xffe0, notify: 0xffe1, write: 0xffe1 },
  { service: 0x18f0, notify: 0x2af0, write: 0x2af1 },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', notify: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
];
export class WebBleTransport extends WebSerialTransport {
  static available() { return typeof navigator !== 'undefined' && 'bluetooth' in navigator; }
  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_PROFILES.map((p) => p.service) });
    const gatt = await this.device.gatt.connect();
    for (const p of BLE_PROFILES) {
      try {
        const svc = await gatt.getPrimaryService(p.service);
        this.rx = await svc.getCharacteristic(p.notify);
        this.tx = await svc.getCharacteristic(p.write);
        break;
      } catch {}
    }
    if (!this.rx) throw new Error('This Bluetooth device does not look like a BLE OBD adapter. Classic adapters: pair in Windows and use Connect adapter (COM/USB).');
    this.buffer = '';
    const dec = new TextDecoder();
    this.rx.addEventListener('characteristicvaluechanged', (e) => this.onData(dec.decode(e.target.value)));
    await this.rx.startNotifications();
    this.address = this.device.id;
  }
  async send(cmd, timeout = 4000) {
    this.buffer = '';
    const done = new Promise((resolve, reject) => {
      this.waiter = { resolve };
      setTimeout(() => { if (this.waiter?.resolve === resolve) { this.waiter = null; reject(new Error(`Timeout on ${cmd}`)); } }, timeout);
    });
    const bytes = new TextEncoder().encode(cmd + '\r');
    if (this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(bytes);
    else await this.tx.writeValue(bytes);
    return done;
  }
  async disconnect() {
    try { await this.rx?.stopNotifications(); } catch {}
    try { this.device?.gatt.disconnect(); } catch {}
    this.address = null;
  }
}

// Browser demo: a simulated 2001-era Ford PCM on J1850 PWM so the whole OBD
// screen can be tried on a PC without an adapter.
export class DemoTransport {
  constructor() { this.t0 = Date.now(); this.dtcs = ['P0171', 'P0174']; }
  static available() { return true; }
  async scan() { return [{ name: 'Demo ELM327 (simulated)', address: 'DEMO' }]; }
  async connect() { this.address = 'DEMO'; }
  async disconnect() { this.address = null; }
  async send(cmd) {
    // A real ELM327 can't take overlapping commands; fail loudly if we try.
    if (this.busy) throw new Error(`Overlapping command ${cmd} while ${this.busy} is running`);
    this.busy = cmd;
    try { return await this.reply(cmd); } finally { this.busy = null; }
  }
  async reply(cmd) {
    await new Promise((r) => setTimeout(r, 25 + Math.random() * 40));
    const c = cmd.toUpperCase().replace(/\s/g, '');
    const t = (Date.now() - this.t0) / 1000;
    const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
    if (c === 'ATZ' || c === 'ATI') return 'ELM327 v1.5';
    if (c === 'ATRV') return (14.1 + Math.sin(t / 3) * 0.15).toFixed(1) + 'V';
    if (c === 'ATDPN') return 'A1';
    if (c === 'ATDP') return 'AUTO, SAE J1850 PWM';
    if (c.startsWith('AT')) return 'OK';
    if (c === '0100') return '41 00 1F BF 99 83';
    if (c === '0120') return '41 20 00 00 00 00';
    if (c === '03') return '43 ' + this.dtcs.map((d) => d.slice(1).match(/../g).join(' ')).join(' ') + ' 00 00';
    if (c === '07') return 'NO DATA';
    if (c === '04') { this.dtcs = []; return '44'; }
    const rpm = 760 + Math.max(0, Math.sin(t / 6)) * 2200 + Math.random() * 30;
    const warm = Math.min(1, t / 60);
    const map = {
      '0104': hx(55 + Math.sin(t / 6) * 30), '0105': hx(40 + 40 + warm * 50 + Math.sin(t / 20) * 2), '0106': hx(128 + Math.sin(t) * 6),
      '0107': hx(128 + 18), '0108': hx(128 + Math.cos(t) * 6), '0109': hx(128 + 17), '010C': hx((rpm * 4) / 256) + ' ' + hx((rpm * 4) % 256),
      '010D': hx(Math.max(0, Math.sin(t / 6)) * 90), '010E': hx((18 + Math.sin(t) * 6 + 64) * 2), '010F': hx(40 + 28),
      '0110': hx(Math.floor((rpm / 100 * 100) / 256)) + ' ' + hx((rpm / 100 * 100) % 256), '0111': hx(30 + Math.max(0, Math.sin(t / 6)) * 120),
      '0114': hx((0.45 + Math.sin(t * 3) * 0.4) * 200) + ' FF', '0115': hx(0.7 * 200) + ' FF', '0118': hx((0.45 + Math.cos(t * 3) * 0.4) * 200) + ' FF', '0119': hx(0.68 * 200) + ' FF',
    };
    const k = c.slice(0, 4);
    return map[k] ? `41 ${k.slice(2)} ${map[k]}` : 'NO DATA';
  }
}

// ---------- ELM327 protocol ----------
export class Elm327 {
  constructor(transport, log = () => {}) {
    this.t = transport;
    this.log = log;
    this.supported = new Set();
    this.protocol = '';
    this.isCan = false;
    this.queue = Promise.resolve();
  }
  // The ELM327 handles one command at a time: sending a second one while the
  // first is running aborts it ("STOPPED") and confuses the reply routing.
  // Every command goes through this queue so live polling, code reads and
  // init never overlap.
  cmd(c, timeout) {
    const run = this.queue.then(() => this.exec(c, timeout));
    this.queue = run.catch(() => {});
    return run;
  }
  async exec(c, timeout, retry = true) {
    let r;
    try {
      r = await this.t.send(c, timeout);
    } catch (e) {
      this.log(`> ${c}\n(${e.message || e})`);
      throw e;
    }
    const clean = r.replace(new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
    this.log(`> ${c}\n${clean}`);
    if (retry && /^(STOPPED|\?)$/i.test(clean)) return this.exec(c, timeout, false);
    return clean;
  }
  async init() {
    await this.cmd('ATZ', 6000).catch(() => {});
    this.version = await this.cmd('ATI').catch(() => '');
    for (const c of ['ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATAT1', 'ATSP0']) await this.cmd(c);
    // First request makes the adapter search protocols (J1850 PWM on 1996-2003 Fords).
    const r = await this.cmd('0100', 15000);
    if (/UNABLE|ERROR|NO DATA/i.test(r)) throw new Error(`Adapter couldn't talk to the car: ${r}. Ignition on? Older Fords need an adapter with J1850 PWM support.`);
    this.protocol = await this.cmd('ATDP').catch(() => '');
    const dpn = await this.cmd('ATDPN').catch(() => '');
    this.isCan = /[6-9]$/.test(dpn.replace(/^A/, ''));
    this.parseSupported('00', r);
    for (const base of ['20', '40']) {
      if (!this.supported.has(base)) break;
      this.parseSupported(base, await this.cmd('01' + base).catch(() => ''));
    }
    return { version: this.version, protocol: this.protocol, supported: [...this.supported] };
  }
  parseSupported(base, resp) {
    const bytes = this.dataBytes(resp, base);
    if (!bytes || bytes.length < 4) return;
    const start = parseInt(base, 16);
    bytes.slice(0, 4).forEach((b, i) => {
      for (let bit = 0; bit < 8; bit++) {
        if (b & (0x80 >> bit)) this.supported.add((start + i * 8 + bit + 1).toString(16).toUpperCase().padStart(2, '0'));
      }
    });
  }
  // Extract data bytes following "41 XX" from possibly multi-ECU output.
  dataBytes(resp, pid) {
    for (const line of resp.split(/[\r\n]+/)) {
      const h = line.replace(/\s/g, '').toUpperCase();
      const i = h.indexOf('41' + pid);
      if (i === -1) continue;
      const data = h.slice(i + 4);
      return data.match(/../g)?.map((x) => parseInt(x, 16)) || [];
    }
    return null;
  }
  async readPid(pid) {
    const def = PIDS[pid];
    const r = await this.cmd('01' + pid);
    const bytes = this.dataBytes(r, pid);
    if (!bytes || bytes.length < def.bytes) return null;
    return def.f(bytes);
  }
  async readVoltage() {
    const r = await this.cmd('ATRV');
    const v = parseFloat(r);
    return Number.isFinite(v) ? v : null;
  }
  async readDtcs() {
    const stored = parseDtcResponse(await this.cmd('03', 8000), '43', this.isCan);
    const pending = parseDtcResponse(await this.cmd('07', 8000).catch(() => ''), '47', this.isCan);
    return { stored, pending: pending.filter((c) => !stored.includes(c)) };
  }
  async clearDtcs() {
    const r = await this.cmd('04', 8000);
    return /44|OK/.test(r.replace(/\s/g, ''));
  }
}

// Poll loop: reads the chosen PIDs (that the car supports) plus adapter
// voltage, and emits one sample object per pass.
export class Poller {
  // rateMs: minimum time per full cycle (0 = as fast as the adapter answers).
  constructor(elm, pids, onSample, { rateMs = 0 } = {}) {
    this.elm = elm;
    this.onSample = onSample;
    this.rateMs = rateMs;
    this.running = false;
    this.hz = 0;
    this.setPids(pids);
  }
  setPids(pids) { this.pids = [...new Set(pids)].filter((p) => this.elm.supported.has(p)); }
  setRate(ms) { this.rateMs = ms; this.wake?.(); }
  sleep(ms) { return new Promise((r) => { const t = setTimeout(r, ms); this.wake = () => { clearTimeout(t); r(); }; }); }
  async start() {
    this.running = true;
    let n = 0;
    while (this.running) {
      const t0 = Date.now();
      const sample = { t: t0 };
      for (const pid of this.pids) {
        if (!this.running) break;
        try {
          const v = await this.elm.readPid(pid);
          if (v != null) sample[PIDS[pid].ch] = v;
        } catch (e) { /* skip one slow PID */ }
      }
      if (n++ % 5 === 0 || sample.voltage == null) {
        try { const v = await this.elm.readVoltage(); if (v != null) sample.voltage = v; } catch {}
      }
      this.onSample(sample);
      const left = this.rateMs - (Date.now() - t0);
      if (left > 0 && this.running) await this.sleep(left);
      const dt = Date.now() - t0;
      this.hz = dt ? 1000 / dt : 0;
    }
  }
  stop() { this.running = false; this.wake?.(); }
}
