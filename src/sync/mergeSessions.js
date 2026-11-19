// OBD session merge for sync pulls. Pure, so it can be tested without a database.

export const sessionKey = (s) => s.uid || `${s.vehicleId}|${s.date}|${s.name}`;

// local, remote: session arrays. remote undefined = the other device sends no OBD data.
export function mergeSessions(local, remote) {
  if (!Array.isArray(remote)) return local;
  const byKey = new Map(local.map((s) => [sessionKey(s), s]));
  const out = [];
  const seen = new Set();
  for (const r of remote) {
    const k = sessionKey(r);
    seen.add(k);
    const mine = byKey.get(k);
    out.push({ ...r, rows: mine?.rows || r.rows }); // keep this device's raw rows
  }
  for (const s of local) if (!seen.has(sessionKey(s))) out.push(s); // recorded here, not synced
  // Ids differ per device: let this database number them.
  return out.map(({ id, ...rest }) => (rest.rows === undefined ? (delete rest.rows, rest) : rest));
}

