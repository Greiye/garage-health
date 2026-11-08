// Health engine. Each part's health is the worst of several signals, each
// expressed as "fraction of life used" (0 = new, 1 = due/limit, >1 overdue):
//   - service interval (miles and months since last service/replacement)
//   - component age (months since manufacture date, e.g. tire DOT date)
//   - latest measurement (tread, pad thickness, voltage...)
//   - active flags (symptoms you log, OBD live alerts, trouble codes)
// Red always blinks on the 3D model.

export const LEVELS = {
  unknown: { label: 'No data', color: '#64748b', rank: -1 },
  green: { label: 'Good', color: '#22c55e', rank: 0 },
  yellow: { label: 'Watch', color: '#eab308', rank: 1 },
  orange: { label: 'Needs inspection', color: '#f97316', rank: 2 },
  // Orange from a replacement coming up (not an inspection)
  service_soon: { label: 'Service due soon' },
  red: { label: 'Overdue / bad', color: '#ef4444', rank: 3 },
};

export const FLAG_SEVERITY = {
  watch: { label: 'Watch', frac: 0.6 },
  warn: { label: 'Needs attention', frac: 0.9 },
  critical: { label: 'Critical', frac: 1.2 },
};

export const SOURCE_LABEL = { user: 'Symptom', inspection: 'Inspection', obd: 'OBD', dtc: 'DTC' };

export function levelFor(frac) {
  if (frac == null || Number.isNaN(frac)) return 'unknown';
  if (frac >= 1) return 'red';
  if (frac >= 0.8) return 'orange';
  if (frac >= 0.5) return 'yellow';
  return 'green';
}

export function monthsBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return (d2 - d1) / (1000 * 60 * 60 * 24 * 30.4375);
}

// "WWYY" DOT code (e.g. 2321 = week 23 of 2021) → ISO date
export function dotToDate(dot) {
  const m = String(dot || '').replace(/\D/g, '').match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const week = +m[1], yr = 2000 + +m[2];
  if (week < 1 || week > 53) return null;
  const d = new Date(Date.UTC(yr, 0, 1 + (week - 1) * 7));
  return d.toISOString().slice(0, 10);
}

// ctx: { odometer, today, lastService: Map(partId -> {date, miles}),
//        component: Map(partId -> component), flags: Map(partId -> [flag]) }
export function partHealth(part, ctx) {
  const reasons = [];
  let worst = null;
  const push = (frac, text) => {
    if (frac == null || Number.isNaN(frac)) return;
    reasons.push({ frac, text, level: levelFor(frac) });
    worst = worst == null ? frac : Math.max(worst, frac);
  };
  const comp = ctx.component.get(part.id);
  const last = ctx.lastService.get(part.id);
  const today = ctx.today;
  const odo = ctx.odometer;

  // Interval: latest of service log and current component install
  let base = last ? { ...last } : null;
  if (comp && (comp.installDate || comp.installMiles != null)) {
    const ci = { date: comp.installDate, miles: comp.installMiles };
    if (!base || (ci.date && base.date && ci.date > base.date)) base = ci;
  }
  if ((part.im || part.mo) && base) {
    if (part.im && base.miles != null && odo != null) {
      const used = odo - base.miles;
      push(used / part.im, `${fmt(used)} of ${fmt(part.im)} mi since last service`);
    }
    if (part.mo && base.date) {
      const m = monthsBetween(base.date, today);
      push(m / part.mo, `${m.toFixed(1)} of ${part.mo} months since last service`);
    }
  } else if ((part.im || part.mo) && !base) {
    reasons.push({ frac: null, level: 'unknown', text: 'No service recorded yet' });
  }

  // Inspection interval: "time to check it". Overdue inspections show as
  // Due soon (orange), not red: not checking a part doesn't mean it's bad.
  const ins = part.inspect;
  if (ins && (ins.im || ins.mo)) {
    let ib = base ? { ...base } : null;
    const ck = ctx.checked?.get(part.id);
    if (ck && (!ib || !ib.date || (ck.date || '') >= ib.date)) ib = { date: ck.date, miles: ck.miles ?? null };
    if (ib) {
      const fr = [];
      if (ins.im && ib.miles != null && odo != null) fr.push([(odo - ib.miles) / ins.im, `${fmt(odo - ib.miles)} of ${fmt(ins.im)} mi since last check`]);
      if (ins.mo && ib.date) { const m = monthsBetween(ib.date, today); fr.push([m / ins.mo, `${m.toFixed(1)} of ${ins.mo} months since last check`]); }
      for (const [f, t] of fr) push(Math.min(0.95, f), f >= 1 ? `Inspection due: ${t}` : t);
    } else if (!(part.im || part.mo)) {
      reasons.push({ frac: null, level: 'unknown', text: 'Not checked yet' });
    }
  }

  // Typical life: no factory replacement interval, but parts like this
  // usually wear out around here. Past it → Watch (yellow), never red.
  const life = part.life;
  if (life && (life.im || life.mo) && base && !(part.im || part.mo)) {
    const over = [];
    if (life.im && base.miles != null && odo != null && odo - base.miles >= life.im) over.push(`${fmt(odo - base.miles)} mi`);
    if (life.mo && base.date) { const m = monthsBetween(base.date, today); if (m >= life.mo) over.push(`${(m / 12).toFixed(1)} years`); }
    if (over.length) push(0.6, `Past typical life (${[life.im && fmt(life.im) + ' mi', life.mo && (life.mo / 12).toFixed(0) + ' yr'].filter(Boolean).join(' / ')}): ${over.join(', ')} since replaced. Inspect and plan replacement.`);
  }

  // Component age
  if (part.age && comp) {
    const born = comp.mfgDate || comp.installDate;
    if (born) {
      const m = monthsBetween(born, today);
      push(m / part.age, `${(m / 12).toFixed(1)} years old (limit ${(part.age / 12).toFixed(0)} years${comp.mfgDate ? '' : ', from install date'})`);
    }
  }

  // Measurement
  const ms = part.measure;
  if (ms && ms.nominal != null && ms.limit != null && ms.nominal !== ms.limit && comp?.measurements?.length) {
    const latest = [...comp.measurements].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const frac = (ms.nominal - latest.value) / (ms.nominal - ms.limit);
    push(Math.max(0, frac), `${ms.label}: ${latest.value} ${ms.unit} (limit ${ms.limit})`);
  }

  // Flags
  for (const f of ctx.flags.get(part.id) || []) {
    push(FLAG_SEVERITY[f.severity]?.frac ?? 0.6, `${SOURCE_LABEL[f.source] || f.source.toUpperCase()}: ${f.text}`);
  }

  // Passed an inspection or test → good unless something else says otherwise
  const insp = ctx.inspected?.get(part.id);
  if (worst == null && insp) push(0, `Passed inspection ${insp}`);

  // Condition-based part with a known component and nothing wrong → good
  if (worst == null && !part.im && !part.mo && (comp || last)) push(0, 'Installed, no issues logged');

  const level = levelFor(worst);
  reasons.sort((a, b) => (b.frac ?? -1) - (a.frac ?? -1));
  // Orange from a replacement coming up reads "Service due soon", not "Needs inspection".
  const orange = reasons.filter((r) => r.level === 'orange');
  const serviceOnly = level === 'orange' && orange.length > 0 && orange.every((r) => /service/i.test(r.text));
  const levelLabel = serviceOnly ? LEVELS.service_soon.label : LEVELS[level].label;
  return { frac: worst, level, levelLabel, blink: level === 'red', reasons };
}

const fmt = (n) => Math.round(n).toLocaleString();

export function worstLevel(levels) {
  let best = 'unknown';
  for (const l of levels) if (LEVELS[l].rank > LEVELS[best].rank) best = l;
  return best;
}
