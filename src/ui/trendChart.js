import { esc } from './util.js';

// One point per session, oldest left. The healthy band (if any) is shaded and
// points outside it are drawn orange. Plain SVG so it scales on phone and PC.
export function trendSvg(points, metric, range) {
  if (!points.length) return '<p class="muted small">No sessions with this value yet.</p>';
  const W = 600, H = 200, L = 46, R = 12, T = 12, B = 34;
  const ts = points.map((p) => Date.parse(p.date));
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (range) { if (Number.isFinite(range[0])) lo = Math.min(lo, range[0]); if (Number.isFinite(range[1])) hi = Math.max(hi, range[1]); }
  const padV = (hi - lo || Math.abs(hi) || 1) * 0.12;
  lo -= padV; hi += padV;
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const X = (t) => (t1 === t0 ? L + (W - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const dp = metric.dp;
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const out = (v) => range && (v < range[0] || v > range[1]);
  const band = range ? `<rect class="tr-band" x="${L}" width="${W - L - R}" y="${Y(Math.min(range[1], hi))}" height="${Math.max(0, Y(Math.max(range[0], lo)) - Y(Math.min(range[1], hi)))}"/>` : '';
  const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const xl = t1 === t0 ? [t0] : [t0, t1];
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.label)} trend">
    ${band}
    ${ticks.map((v) => `<line class="tr-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tr-ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(dp)}</text>`).join('')}
    ${xl.map((t, i) => `<text class="tr-ax" x="${X(t)}" y="${H - 10}" text-anchor="${xl.length === 1 ? 'middle' : i ? 'end' : 'start'}">${fmtD(t)}</text>`).join('')}
    ${points.length > 1 ? `<polyline class="tr-line" points="${points.map((p, i) => `${X(ts[i])},${Y(p.v)}`).join(' ')}"/>` : ''}
    ${points.map((p, i) => `<circle class="tr-pt ${out(p.v) ? 'tr-out' : ''}" cx="${X(ts[i])}" cy="${Y(p.v)}" r="5"><title>${esc(new Date(ts[i]).toLocaleDateString())}: ${p.v.toFixed(dp)} ${esc(metric.unit)} (${p.n} rows)</title></circle>`).join('')}
    <text class="tr-ax" x="${L}" y="${T - 2}">${esc(metric.unit)}</text>
  </svg>`;
}
