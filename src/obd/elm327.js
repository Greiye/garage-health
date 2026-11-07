import { Capacitor } from '@capacitor/core';
import { PIDS } from './pids.js';
import { parseDtcResponse } from './dtc.js';

// ---------- Transports ----------
// Android: Bluetooth Classic SPP via @e-is/capacitor-bluetooth-serial — the same
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
  async plugin() {
    if (!this._p) this._p = (await import('@e-is/capacitor-bluetooth-serial')).BluetoothSerial;
    return this._p;
  }
  async enable() {
    const p = await this.plugin();
    const { enabled } = await p.enable();
    if (!enabled) throw new Error('Bluetooth is off');
  }
  async scan() {
    const p = await this.plugin();
    await this.enable();
    const { devices } = await p.scan();
    return devices;
  }
  async connect(address) {
    const p = await this.plugin();
    await this.enable();
    try {
      await p.connect({ address });
    } catch (e) {
      // Many clones only accept insecure RFCOMM.
      await p.connectInsecure({ address });
    }
    this.address = address;
    this.listener = await p.addListener('onRead', ({ value }) => this.onData(value));
    await p.startNotifications({ address, delimiter: '>' });
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
    const p = await this.plugin();
    this.buffer = '';
    const done = new Promise((resolve, reject) => {
      this.waiter = { resolve };
      setTimeout(() => {
        if (this.waiter?.resolve === resolve) {
          this.waiter = null;
          reject(new Error(`Timeout on ${cmd}`));
        }
      }, timeout);
    });
    await p.write({ address: this.address, value: cmd + '\r' });
    return done;
  }
  async disconnect() {
    const p = await this.plugin();
    try { await p.stopNotifications({ address: this.address }); } catch {}
    try { await this.listener?.remove(); } catch {}
    try { await p.disconnect({ address: this.address }); } catch {}
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
    await new Promise((r) => setTimeout(r, 25));
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
  }
  async cmd(c, timeout) {
    const r = await this.t.send(c, timeout);
    const clean = r.replace(new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
    this.log(`> ${c}\n${clean}`);
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
  constructor(elm, pids, onSample) {
    this.elm = elm;
    this.pids = pids.filter((p) => elm.supported.has(p));
    this.onSample = onSample;
    this.running = false;
  }
  async start() {
    this.running = true;
    let n = 0;
    while (this.running) {
      const sample = { t: Date.now() };
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
    }
  }
  stop() { this.running = false; }
}
