import Dexie from 'dexie';

// One database for every vehicle. All rows carry vehicleId so the app is
// vehicle-agnostic: the Mustang is just the first profile.
export const db = new Dexie('garage-health');

db.version(1).stores({
  vehicles: '++id, name',
  // A part is a maintainable location/item on a vehicle (e.g. "Tire FL",
  // "Engine oil", "Front strut L"). It owns intervals and limits.
  parts: '++id, vehicleId, key, system, slot',
  // A component is a physical item installed at a part (a specific tire,
  // a specific strut). Replacing one ends its tenure and starts another.
  components: '++id, vehicleId, partId, installDate, removedDate',
  // Service log entries. partIds lists every part the job touched.
  services: '++id, vehicleId, date, miles, *partIds',
  // Binary files: photos (before/after), receipts (pdf/webp/jpg), etc.
  attachments: '++id, vehicleId, serviceId, componentId, kind',
  // Symptoms and alerts raised by the user, OBD live data or DTCs.
  flags: '++id, vehicleId, partId, source, active',
  // OBD data sessions (live recordings or CSV imports).
  obdSessions: '++id, vehicleId, date, source',
  // Trouble codes seen on a vehicle.
  dtcs: '++id, vehicleId, code, active',
  // Odometer readings.
  odometer: '++id, vehicleId, date',
  settings: 'key',
});

// v2: inspections (150+ point checklist runs and test battery results)
db.version(2).stores({
  inspections: '++id, vehicleId, date, status',
});

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------- Backup ----------
const blobToDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

export async function exportBackup() {
  const out = { app: 'garage-health', version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of db.tables) {
    let rows = await t.toArray();
    if (t.name === 'settings') rows = rows.filter((r) => !LOCAL_ONLY_SETTINGS.includes(r.key)); // never export the sync token
    if (t.name === 'attachments') {
      for (const r of rows) if (r.blob instanceof Blob) r.blob = await blobToDataURL(r.blob);
    }
    out.tables[t.name] = rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

// Settings that belong to this device only (sync credentials and state).
export const LOCAL_ONLY_SETTINGS = ['sync', 'syncState', 'obdAddress', 'obdAdapters', 'keepScreenOn'];

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'garage-health') throw new Error('Not a Garage Health backup file');
  const keep = (await db.settings.toArray()).filter((r) => LOCAL_ONLY_SETTINGS.includes(r.key));
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear();
      let rows = data.tables[t.name] || [];
      if (t.name === 'settings') rows = [...rows.filter((r) => !LOCAL_ONLY_SETTINGS.includes(r.key)), ...keep];
      if (t.name === 'attachments') {
        for (const r of rows) if (typeof r.blob === 'string') r.blob = await (await fetch(r.blob)).blob();
      }
      if (rows.length) await t.bulkAdd(rows);
    }
  });
}
