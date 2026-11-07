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
  orange: { label: 'Due soon', color: '#f97316', rank: 2 },
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
  return { frac: worst, level, blink: level === 'red', reasons };
}

const fmt = (n) => Math.round(n).toLocaleString();

export function worstLevel(levels) {
  let best = 'unknown';
  for (const l of levels) if (LEVELS[l].rank > LEVELS[best].rank) best = l;
  return best;
}
