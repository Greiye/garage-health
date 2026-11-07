import Papa from 'papaparse';
import { CHANNELS } from './pids.js';

// Imports data logs from OBD Fusion, OBDroid and similar apps. Their headers
// differ ("Engine RPM (RPM)", "Engine coolant temperature (°F)", "Coolant
// Temp [C]", "RPM"...), so each header is matched against keyword patterns
// and its unit is read from the brackets and converted to US units.

const MATCHERS = [
  ['rpm', /\b(engine\s*)?rpm\b|engine speed/],
  ['speed', /vehicle speed|^speed|\bspeed\s*\(|gps speed|\bvss\b/],
  ['coolant', /coolant|\bect\b|engine temp/],
  ['iat', /intake air temp|\biat\b|air intake temp/],
  ['ltft1', /long\s*term.*(bank\s*1|b1)|\bltft\s*(1|b1)\b|\bltft$/],
  ['ltft2', /long\s*term.*(bank\s*2|b2)|\bltft\s*(2|b2)\b/],
  ['stft1', /short\s*term.*(bank\s*1|b1)|\bstft\s*(1|b1)\b|\bstft$/],
  ['stft2', /short\s*term.*(bank\s*2|b2)|\bstft\s*(2|b2)\b/],
  ['maf', /\bmaf\b|mass air ?flow/],
  ['map', /manifold (absolute )?pressure|\bmap\b/],
  ['throttle', /throttle|\btps\b/],
  ['load', /engine load|calculated load|\bload\b/],
  ['timing', /timing advance|ignition timing|spark advance/],
  ['o2_b1s1', /(o2|oxygen).*(b(ank)?\s*1).*(s(ensor)?\s*1)|o2s?11\b/],
  ['o2_b1s2', /(o2|oxygen).*(b(ank)?\s*1).*(s(ensor)?\s*2)|o2s?12\b/],
  ['o2_b2s1', /(o2|oxygen).*(b(ank)?\s*2).*(s(ensor)?\s*1)|o2s?21\b/],
  ['o2_b2s2', /(o2|oxygen).*(b(ank)?\s*2).*(s(ensor)?\s*2)|o2s?22\b/],
  ['voltage', /voltage|battery|module volt|control module/],
  ['fuel', /fuel level|fuel tank level/],
  ['baro', /barometric|\bbaro\b/],
  ['ambient', /ambient/],
  ['oiltemp', /oil temp/],
  ['transtemp', /trans(mission)? (fluid )?temp|\btft\b/],
  ['runtime', /run ?time|time since engine start/],
];

const TIME_RE = /^(time|timestamp|date|device time|gps time|elapsed|seconds|sec\b|time \(s(ec)?\))/;

function unitOf(header) {
  const m = header.match(/[([]\s*([^)\]]+)\s*[)\]]\s*$/);
  return m ? m[1].trim().toLowerCase() : '';
}

function convert(ch, unit, v) {
  if (v == null || Number.isNaN(v)) return null;
  const u = unit.replace('°', '').replace('deg', '').trim();
  if (['coolant', 'iat', 'ambient', 'oiltemp', 'transtemp'].includes(ch) && (u === 'c' || u === 'celsius')) return v * 9 / 5 + 32;
  if (ch === 'speed' && /km/.test(u)) return v * 0.621371;
  if (ch === 'speed' && u === 'm/s') return v * 2.23694;
  if ((ch === 'map' || ch === 'baro') && u === 'psi') return v * 6.89476;
  if ((ch === 'map' || ch === 'baro') && /inhg|in hg/.test(u)) return v * 3.38639;
  if (ch === 'maf' && /lb/.test(u)) return v * 7.55987; // lb/min → g/s
  return v;
}

export function detectSource(text, fileName = '') {
  const head = text.slice(0, 2000).toLowerCase();
  if (/obd ?fusion|ocTech|obdwiz/i.test(head) || /fusion/i.test(fileName)) return 'obdfusion';
  if (/obdroid/i.test(head) || /obdroid/i.test(fileName)) return 'obdroid';
  if (/gps time.*device time/.test(head)) return 'torque';
  return 'csv';
}

// Some apps write a few metadata lines before the header. Find the first line
// that looks like a header: several delimited, mostly non-numeric fields
// followed by a line of mostly numeric fields.
function stripPreamble(text) {
  const lines = text.split(/\r?\n/);
  const delim = [',', ';', '\t'].map((d) => [d, (lines.slice(0, 30).join('\n').match(new RegExp(d === '\t' ? '\t' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < Math.min(lines.length - 1, 40); i++) {
    const a = lines[i].split(delim), b = (lines[i + 1] || '').split(delim);
    if (a.length < 2 || b.length < 2) continue;
    const nonNum = a.filter((x) => x.trim() && Number.isNaN(+x.replace(/"/g, ''))).length;
    const num = b.filter((x) => x.trim() !== '' && !Number.isNaN(+x.replace(/"/g, '').replace(',', '.'))).length;
    if (nonNum >= a.length * 0.6 && num >= 1) return { body: lines.slice(i).join('\n'), delim };
  }
  return { body: text, delim };
}

export function parseObdCsv(text, fileName = '') {
  const source = detectSource(text, fileName);
  const { body, delim } = stripPreamble(text);
  const parsed = Papa.parse(body, { header: true, delimiter: delim, skipEmptyLines: true, dynamicTyping: false });
  const headers = parsed.meta.fields || [];
  const mapping = {};
  const used = new Set();
  let timeCol = null;
  for (const h of headers) {
    const n = h.toLowerCase().replace(/\s+/g, ' ').trim();
    const bare = n.replace(/[([].*$/, '').trim();
    if (!timeCol && TIME_RE.test(bare)) { timeCol = h; continue; }
    for (const [ch, re] of MATCHERS) {
      if (used.has(ch)) continue;
      if (re.test(bare)) {
        mapping[h] = { ch, unit: unitOf(h) };
        used.add(ch);
        break;
      }
    }
  }
  const unmatched = headers.filter((h) => h !== timeCol && !mapping[h]);
  const rows = [];
  let t0 = null;
  for (const r of parsed.data) {
    const s = {};
    let any = false;
    for (const [h, { ch, unit }] of Object.entries(mapping)) {
      const raw = String(r[h] ?? '').replace(/"/g, '').trim();
      if (raw === '' || raw === '-') continue;
      const v = convert(ch, unit, parseFloat(raw.replace(',', '.')));
      if (v != null && Number.isFinite(v)) { s[ch] = v; any = true; }
    }
    if (!any) continue;
    if (timeCol) {
      const tv = String(r[timeCol] ?? '').trim();
      let t = parseFloat(tv);
      if (Number.isNaN(t) || /[-:/]/.test(tv)) { const d = Date.parse(tv); t = Number.isNaN(d) ? rows.length : d / 1000; }
      if (t > 1e11) t /= 1000; // ms epoch
      if (t0 == null) t0 = t;
      s.t = t - t0;
    } else s.t = rows.length;
    rows.push(s);
  }
  return { source, rows, mapping, unmatched, timeCol, headerCount: headers.length };
}

export function summarize(rows) {
  const stats = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k === 't') continue;
      const s = (stats[k] ||= { min: Infinity, max: -Infinity, sum: 0, n: 0 });
      s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); s.sum += v; s.n++;
    }
  }
  for (const s of Object.values(stats)) s.avg = s.sum / s.n;
  return stats;
}

// Downsample to at most n rows for storage/charting
export function downsample(rows, n = 4000) {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

export { CHANNELS };
