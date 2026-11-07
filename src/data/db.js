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
    const rows = await t.toArray();
    if (t.name === 'attachments') {
      for (const r of rows) if (r.blob instanceof Blob) r.blob = await blobToDataURL(r.blob);
    }
    out.tables[t.name] = rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'garage-health') throw new Error('Not a Garage Health backup file');
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear();
      const rows = data.tables[t.name] || [];
      if (t.name === 'attachments') {
        for (const r of rows) if (typeof r.blob === 'string') r.blob = await (await fetch(r.blob)).blob();
      }
      if (rows.length) await t.bulkAdd(rows);
    }
  });
}
