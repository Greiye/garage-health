import { db, todayISO, getSetting, setSetting } from './db.js';
import { buildPartList, PRESETS } from './templates.js';
import { partHealth, worstLevel } from './health.js';
import { buildInspection, buildTests, summarizeRun } from './inspection.js';
import { buildCatalog, mergeCatalog } from './catalog.js';
import { VEHICLE_CATALOGS } from './catalogs/index.js';
import { withSchedule } from './schedule.js';

// Virtual slots light several meshes at once.
export const VIRTUAL_SLOTS = { tires: ['tire_FL', 'tire_FR', 'tire_RL', 'tire_RR'] };

export async function createVehicle({ presetId, name, vehicle = {}, options, odometer, odometerDate }) {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[1];
  const opts = { ...preset.options, ...(options || {}) };
  const v = {
    name: name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || preset.label,
    ...preset.vehicle,
    ...vehicle,
    presetId: preset.id,
    options: opts,
    odometer: odometer ?? null,
    odometerDate: odometerDate || todayISO(),
    specs: (preset.specs || []).map(([group, label, value, verify]) => ({ group, label, value, verify: !!verify })),
    specsVersion: SPECS_VERSION,
    createdAt: new Date().toISOString(),
  };
  const id = await db.vehicles.add(v);
  const defs = buildPartList(opts);
  await db.parts.bulkAdd(defs.map((d) => ({ ...d, vehicleId: id, notes: preset.partNotes?.[d.key] || '' })));
  if (odometer != null) await db.odometer.add({ vehicleId: id, date: v.odometerDate, miles: odometer, source: 'setup' });
  await setSetting('currentVehicle', id);
  return id;
}

// Re-generate the part list after options change. Keeps existing parts
// (and their history) whose keys still apply; adds new ones; parts that no
// longer apply are kept but marked hidden so history isn't lost.
export async function applyOptions(vehicleId, options) {
  await db.vehicles.update(vehicleId, { options });
  const defs = buildPartList(options);
  const existing = await db.parts.where({ vehicleId }).toArray();
  const byKey = new Map(existing.map((p) => [p.key, p]));
  const keys = new Set(defs.map((d) => d.key));
  for (const d of defs) {
    const ex = byKey.get(d.key);
    if (!ex) await db.parts.add({ ...d, vehicleId, notes: '' });
    else if (ex.hidden && !ex.userHidden) await db.parts.update(ex.id, { hidden: false, slot: d.slot, also: d.also });
  }
  for (const p of existing) if (!keys.has(p.key) && !p.custom && !p.hidden) await db.parts.update(p.id, { hidden: true });
}

export async function currentVehicleId() {
  let id = await getSetting('currentVehicle');
  if (id && (await db.vehicles.get(id))) return id;
  const first = await db.vehicles.toCollection().first();
  return first?.id ?? null;
}

export async function setOdometer(vehicleId, miles, date = todayISO(), source = 'manual') {
  miles = Math.round(+miles);
  await db.odometer.add({ vehicleId, date, miles, source });
  const v = await db.vehicles.get(vehicleId);
  if (v.odometer == null || miles >= v.odometer) await db.vehicles.update(vehicleId, { odometer: miles, odometerDate: date });
}

// Loads everything needed to render a vehicle and computes health.
export async function loadVehicleState(vehicleId) {
  await syncParts(vehicleId);
  const [vehicle, parts, components, services, flags, inspections] = await Promise.all([
    db.vehicles.get(vehicleId),
    db.parts.where({ vehicleId }).toArray(),
    db.components.where({ vehicleId }).toArray(),
    db.services.where({ vehicleId }).toArray(),
    db.flags.where({ vehicleId }).filter((f) => f.active).toArray(),
    db.inspections.where({ vehicleId }).toArray(),
  ]);
  // Apply the maintenance schedule. A stored interval that differs from the
  // template default was edited by the user, so it counts as custom.
  const defaults = new Map(buildPartList(vehicle.options || {}).map((d) => [d.key, d]));
  const visible = parts.filter((p) => !p.hidden).map((p) => {
    const d = defaults.get(p.key);
    const custom = p.customInterval ?? (p.custom || (d && ((p.im || 0) !== (d.im || 0) || (p.mo || 0) !== (d.mo || 0))));
    return withSchedule(vehicle, { ...p, customInterval: !!custom });
  });
  const component = new Map();
  for (const c of components) if (!c.removedDate && c.partId != null) component.set(c.partId, c);
  const lastService = new Map();
  // Last time each part was checked: Inspection-type log entries and passed
  // inspection runs. Checks reset the inspect interval, not the replace one.
  const checked = new Map();
  const markChecked = (pid, date, miles) => {
    const cur = checked.get(pid);
    if (!cur || (date || '') > (cur.date || '')) checked.set(pid, { date, miles: miles ?? null });
  };
  for (const s of services) {
    if (s.type === 'Inspection') { for (const pid of s.partIds || []) markChecked(pid, s.date, s.miles); continue; }
    for (const pid of s.partIds || []) {
      if ((s.resets || []).length && !s.resets.includes(pid)) continue;
      const cur = lastService.get(pid);
      if (!cur || (s.date || '') > (cur.date || '') || ((s.date || '') === (cur.date || '') && (s.miles ?? 0) > (cur.miles ?? 0))) lastService.set(pid, { date: s.date, miles: s.miles });
    }
  }
  const flagMap = new Map();
  for (const f of flags) {
    if (!flagMap.has(f.partId)) flagMap.set(f.partId, []);
    flagMap.get(f.partId).push(f);
  }
  // Latest inspection pass per part (date), from completed runs
  const inspected = new Map();
  for (const r of inspections) {
    if (r.status !== 'done') continue;
    for (const pid of r.passedParts || []) {
      if (!inspected.has(pid) || inspected.get(pid) < r.date) inspected.set(pid, r.date);
      markChecked(pid, r.date, r.miles);
    }
  }
  const ctx = { odometer: vehicle.odometer, today: todayISO(), lastService, component, flags: flagMap, inspected, checked };
  const health = new Map();
  for (const p of visible) health.set(p.id, partHealth(p, ctx));

  // Slot map for the 3D model
  const slots = new Map();
  const addSlot = (slot, p) => {
    const list = VIRTUAL_SLOTS[slot] || [slot];
    for (const s of list) {
      if (!slots.has(s)) slots.set(s, []);
      slots.get(s).push(p);
    }
  };
  for (const p of visible) {
    addSlot(p.slot, p);
    for (const a of p.also || []) addSlot(a, p);
  }
  const slotHealth = new Map();
  for (const [s, ps] of slots) {
    const levels = ps.map((p) => health.get(p.id).level);
    slotHealth.set(s, { level: worstLevel(levels), blink: ps.some((p) => health.get(p.id).blink), parts: ps });
  }
  return { vehicle, parts: visible, allParts: parts, components, services, flags, component, lastService, checked, health, slotHealth, inspections };
}

export async function addFlag({ vehicleId, partId, source = 'user', severity = 'warn', text, code }) {
  if (code) {
    const ex = await db.flags.where({ vehicleId, partId }).filter((f) => f.active && f.code === code).first();
    if (ex) {
      await db.flags.update(ex.id, { severity, text, lastSeen: new Date().toISOString() });
      return ex.id;
    }
  }
  return db.flags.add({ vehicleId, partId, source, severity, text, code: code || null, active: 1, createdAt: new Date().toISOString() });
}

export const resolveFlag = (id) => db.flags.update(id, { active: 0, resolvedAt: new Date().toISOString() });

// Saves a service entry. replacements: [{ partId, component: {...} }]
// Replacing a part closes the current component and installs a new one.
export async function saveService(entry, { replacements = [], files = [] } = {}) {
  const { id: existingId, ...data } = entry;
  const id = existingId ? (await db.services.update(existingId, data), existingId) : await db.services.add(data);
  for (const r of replacements) {
    const old = await db.components.where({ partId: r.partId }).filter((c) => !c.removedDate).toArray();
    for (const c of old) await db.components.update(c.id, { removedDate: entry.date, removedMiles: entry.miles, removedServiceId: id });
    await db.components.add({
      vehicleId: entry.vehicleId, partId: r.partId, ...r.component,
      installDate: entry.date, installMiles: entry.miles, installServiceId: id, measurements: r.component.measurements || [],
      positionHistory: [{ date: entry.date, miles: entry.miles, partId: r.partId }],
    });
  }
  for (const f of files) await db.attachments.add({ vehicleId: entry.vehicleId, serviceId: id, kind: f.kind, name: f.file.name, type: f.file.type, size: f.file.size, blob: f.file, addedAt: new Date().toISOString() });
  // Servicing a part resolves its user/OBD flags
  if (entry.resolveFlags !== false) {
    const fl = await db.flags.where({ vehicleId: entry.vehicleId }).filter((f) => f.active && (entry.partIds || []).includes(f.partId)).toArray();
    for (const f of fl) await resolveFlag(f.id);
  }
  if (entry.miles != null && entry.date && !entry.baseline) await setOdometer(entry.vehicleId, entry.miles, entry.date, 'service');
  return id;
}

export async function deleteService(id) {
  await db.attachments.where({ serviceId: id }).delete();
  await db.services.delete(id);
}

// Tire rotation: moves current tire components between tire parts.
// mapping: { fromKey: toKey }
export async function rotateTires(vehicleId, mapping, { date, miles, notes }) {
  const parts = await db.parts.where({ vehicleId }).toArray();
  const byKey = new Map(parts.map((p) => [p.key, p]));
  const moves = [];
  for (const [from, to] of Object.entries(mapping)) {
    const fp = byKey.get(from), tp = byKey.get(to);
    if (!fp || !tp) continue;
    const comp = await db.components.where({ partId: fp.id }).filter((c) => !c.removedDate).first();
    if (comp) moves.push({ comp, to: tp });
  }
  for (const { comp, to } of moves) {
    await db.components.update(comp.id, { partId: to.id, positionHistory: [...(comp.positionHistory || []), { date, miles, partId: to.id }] });
  }
  const rot = byKey.get('rotation');
  return saveService({
    vehicleId, date, miles, title: 'Tire rotation', type: 'service',
    partIds: [rot?.id, ...Object.keys(mapping).map((k) => byKey.get(k)?.id)].filter(Boolean),
    resets: [rot?.id].filter(Boolean),
    notes: notes || Object.entries(mapping).map(([a, b]) => `${a.replace('tire_', '')}→${b.replace('tire_', '')}`).join(', '),
    cost: 0,
  });
}

export async function addMeasurement(componentId, m) {
  const c = await db.components.get(componentId);
  await db.components.update(componentId, { measurements: [...(c.measurements || []), m] });
}

export async function ensureComponent(vehicleId, partId) {
  let c = await db.components.where({ partId }).filter((x) => !x.removedDate).first();
  if (!c) {
    const id = await db.components.add({ vehicleId, partId, measurements: [], positionHistory: [], unknownOrigin: true });
    c = await db.components.get(id);
  }
  return c;
}

// Adds parts introduced by newer app versions to existing vehicles.
async function syncParts(vehicleId) {
  const v = await db.vehicles.get(vehicleId);
  if (!v) return;
  const existing = await db.parts.where({ vehicleId }).toArray();
  const have = new Set(existing.map((p) => p.key));
  const preset = PRESETS.find((p) => p.id === v.presetId);
  const missing = buildPartList(v.options).filter((d) => !have.has(d.key));
  if (missing.length) await db.parts.bulkAdd(missing.map((d) => ({ ...d, vehicleId, notes: preset?.partNotes?.[d.key] || '' })));
  // Spec sheet updates: rows still marked "verify" (not confirmed by the
  // user) take the preset's newer value; new preset rows are added.
  if (preset?.specs && (v.specsVersion || 1) < SPECS_VERSION) {
    const labels = new Set(preset.specs.map((x) => x[1]));
    // Unconfirmed rows the preset no longer has were old defaults: drop them.
    const specs = (v.specs || []).filter((x) => !x.verify || labels.has(x.label));
    for (const [group, label, value, verify] of preset.specs) {
      const i = specs.findIndex((x) => x.label === label);
      if (i < 0) specs.push({ group, label, value, verify: !!verify });
      else if (specs[i].verify) specs[i] = { group, label, value, verify: !!verify };
    }
    await db.vehicles.update(vehicleId, { specs, specsVersion: SPECS_VERSION });
  }
}
const SPECS_VERSION = 2;

// ---------- Catalog ----------
export function vehicleCatalog(vehicle) {
  return mergeCatalog(buildCatalog(vehicle.options), VEHICLE_CATALOGS[vehicle.presetId], vehicle.catalogUser);
}

export async function saveCatalogItem(vehicleId, id, patch) {
  const v = await db.vehicles.get(vehicleId);
  const user = { ...(v.catalogUser || {}) };
  user[id] = patch == null ? undefined : { ...(user[id] || {}), ...patch };
  if (patch == null) delete user[id];
  await db.vehicles.update(vehicleId, { catalogUser: user });
}

// ---------- Inspections ----------
export function inspectionDefs(vehicle) {
  const vc = VEHICLE_CATALOGS[vehicle.presetId];
  const tests = buildTests(vehicle.options).map((t) => {
    const ov = vc?.testSpecs?.[t.id];
    if (!ov) return t;
    return { ...t, ...(ov.criteria ? { criteria: ov.criteria } : {}), readings: t.readings.map((r) => ({ ...r, ...(ov.readings?.[r.id] || {}) })) };
  });
  return { items: buildInspection(vehicle.options), tests };
}

export async function startInspection(vehicle, { kind = 'full', testIds = [], title } = {}) {
  return db.inspections.add({
    vehicleId: vehicle.id, kind, title: title || (kind === 'full' ? 'Full inspection' : 'Tests'),
    date: todayISO(), miles: vehicle.odometer ?? null, status: 'draft',
    results: {}, tests: Object.fromEntries(testIds.map((id) => [id, { values: {} }])),
    createdAt: new Date().toISOString(),
  });
}

export const saveInspectionDraft = (id, patch) => db.inspections.update(id, { ...patch, updatedAt: new Date().toISOString() });

export async function deleteInspection(id) {
  await db.inspections.delete(id);
}

const SEV = { watch: 'watch', fail: 'warn' };

// Completes a run: fails and watches become flags on the mapped parts (so the
// 3D model turns yellow/red), passes clear earlier flags from the same check,
// and measurements go into each part's measurement history.
export async function completeInspection(id) {
  const run = await db.inspections.get(id);
  const vehicle = await db.vehicles.get(run.vehicleId);
  const { items, tests } = inspectionDefs(vehicle);
  const { findings, measures } = summarizeRun(run, items, tests);
  const parts = await db.parts.where({ vehicleId: vehicle.id }).toArray();
  const byKey = new Map(parts.filter((p) => !p.hidden).map((p) => [p.key, p]));
  const passed = new Set();
  const failedParts = new Set();
  let flagged = 0;
  for (const f of findings) {
    const ps = f.parts.map((k) => byKey.get(k)).filter(Boolean);
    if (f.status === 'pass') {
      for (const p of ps) {
        passed.add(p.id);
        const old = await db.flags.where({ vehicleId: vehicle.id, partId: p.id }).filter((x) => x.active && x.code === f.key).toArray();
        for (const o of old) await resolveFlag(o.id);
      }
      continue;
    }
    // Checklist items flag every mapped part ("one of these"). A test flags
    // its primary part; a test rule that names parts flags those.
    const targets = f.key.startsWith('test:') && f.key.split(':').length === 2 ? ps.slice(0, 1) : ps;
    for (const p of targets) {
      failedParts.add(p.id);
      await addFlag({ vehicleId: vehicle.id, partId: p.id, source: 'inspection', severity: f.status === 'fail' && f.crit ? 'critical' : SEV[f.status], text: f.text, code: f.key });
      flagged++;
    }
  }
  for (const m of measures) {
    const p = byKey.get(m.part);
    if (!p || !p.measure) continue;
    const c = await ensureComponent(vehicle.id, p.id);
    await addMeasurement(c.id, { date: run.date, miles: run.miles, value: m.value, note: `Inspection: ${m.label}` });
  }
  const passedParts = [...passed].filter((pid) => !failedParts.has(pid));
  await db.inspections.update(id, { status: 'done', completedAt: new Date().toISOString(), passedParts, summary: { findings: findings.length, flagged, measures: measures.length } });
  if (run.miles != null) await setOdometer(vehicle.id, run.miles, run.date, 'inspection');
  return { flagged, measures: measures.length, passed: passedParts.length };
}
