import { db, todayISO, getSetting, setSetting } from './db.js';
import { buildPartList, PRESETS } from './templates.js';
import { partHealth, worstLevel } from './health.js';

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
  const [vehicle, parts, components, services, flags] = await Promise.all([
    db.vehicles.get(vehicleId),
    db.parts.where({ vehicleId }).toArray(),
    db.components.where({ vehicleId }).toArray(),
    db.services.where({ vehicleId }).toArray(),
    db.flags.where({ vehicleId }).filter((f) => f.active).toArray(),
  ]);
  const visible = parts.filter((p) => !p.hidden);
  const component = new Map();
  for (const c of components) if (!c.removedDate && c.partId != null) component.set(c.partId, c);
  const lastService = new Map();
  for (const s of services) {
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
  const ctx = { odometer: vehicle.odometer, today: todayISO(), lastService, component, flags: flagMap };
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
  return { vehicle, parts: visible, allParts: parts, components, services, flags, component, lastService, health, slotHealth };
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
