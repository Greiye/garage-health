import Dexie from 'dexie';
import { db, getSetting, setSetting, LOCAL_ONLY_SETTINGS } from '../data/db.js';

// Phone ⇄ PC sync through a PRIVATE GitHub repo the user owns.
//
// Layout in the data repo:
//   garage/data.json                 every table (except local-only settings), attachments without blobs
//   garage/attachments/<sha256>      photo/receipt bytes, content-addressed so each uploads once
//   garage/conflicts/<time>-<dev>.json   copy of the side that lost a conflict
//
// Model: whole-snapshot sync with change tracking. Each device remembers the
// data.json blob sha it last synced. On sync:
//   remote unchanged + local changed  → push
//   remote changed  + local unchanged → pull
//   both changed                      → ask (keep this device / use synced copy); loser saved to conflicts/
// Git history keeps every version, so nothing is lost either way.

const DATA = 'garage/data.json';
const API = 'https://api.github.com';
let suppress = 0; // >0 while we write pulled data, so it doesn't count as a local change
let timer = null;
const listeners = new Set();
let status = { state: 'off', text: '' };

export const onSyncStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(state, text = '') { status = { state, text, at: Date.now() }; listeners.forEach((f) => f(status)); }

// ---------- change tracking ----------
const TRACKED = () => db.tables.filter((t) => t.name !== 'settings');
let hooked = false;
export function installHooks() {
  if (hooked) return;
  hooked = true;
  const mark = () => { if (!suppress) markDirty(); };
  for (const t of TRACKED()) {
    t.hook('creating', mark);
    t.hook('updating', mark);
    t.hook('deleting', mark);
  }
  db.settings.hook('creating', (k, obj) => { if (!suppress && !LOCAL_ONLY_SETTINGS.includes(obj.key)) markDirty(); });
}
function markDirty() {
  // Hooks run inside the caller's transaction; write outside it.
  setTimeout(() => Dexie.ignoreTransaction(async () => {
    const s = (await getSetting('syncState')) || {};
    if (!s.dirty) await setSetting('syncState', { ...s, dirty: true });
    scheduleAutoSync();
  }), 0);
}

// ---------- GitHub API ----------
async function gh(cfg, path, opts = {}) {
  // no-store: the same contents URL is fetched as JSON metadata and as raw
  // bytes; Android WebView's cache can hand back the wrong one.
  const res = await fetch(`${API}/repos/${cfg.repo}/${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    const msg = res.status === 401 ? 'GitHub token is invalid or expired' : res.status === 403 ? 'Token lacks access to this repo (needs Contents: read and write)' : `GitHub ${res.status}: ${body.slice(0, 200)}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}
const b64FromBlob = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
const b64FromText = (text) => b64FromBlob(new Blob([text], { type: 'application/json' }));

async function getMeta(cfg, path) {
  const r = await gh(cfg, `contents/${path}?ref=${cfg.branch}`);
  return r ? r.json() : null; // { sha, size, ... }
}
async function getRaw(cfg, path, as = 'text') {
  const r = await gh(cfg, `contents/${path}?ref=${cfg.branch}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (!r) return null;
  return as === 'blob' ? r.blob() : r.text();
}
const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s+/g, '')), (c) => c.charCodeAt(0)));

// Read and validate garage/data.json. Falls back to the git blob by sha if the
// raw request comes back as metadata (wrong media type or a cached response).
async function readData(cfg, sha) {
  let obj = JSON.parse(await getRaw(cfg, DATA));
  if (!obj?.tables && obj?.encoding === 'base64' && obj.content) obj = JSON.parse(b64ToText(obj.content));
  if (!obj?.tables && (sha || obj?.sha)) {
    const r = await gh(cfg, `git/blobs/${sha || obj.sha}`);
    const blob = r && (await r.json());
    if (blob?.content) obj = JSON.parse(b64ToText(blob.content));
  }
  if (!obj?.tables) throw new Error(`${DATA} in ${cfg.repo} isn't a Garage Health sync file. Delete or rename it on GitHub, then sync again to upload this device's data.`);
  return obj;
}

async function put(cfg, path, b64, message, sha) {
  const r = await gh(cfg, `contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: b64, branch: cfg.branch, ...(sha ? { sha } : {}) }) });
  return (await r.json()).content.sha;
}
async function listAttachmentHashes(cfg) {
  const r = await gh(cfg, `contents/garage/attachments?ref=${cfg.branch}`);
  if (!r) return new Set();
  return new Set((await r.json()).map((f) => f.name));
}

async function sha256(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- snapshot ----------
async function snapshot() {
  const out = { app: 'garage-health', format: 'sync-1', savedAt: new Date().toISOString(), tables: {} };
  for (const t of db.tables) {
    let rows = await t.toArray();
    if (t.name === 'settings') rows = rows.filter((r) => !LOCAL_ONLY_SETTINGS.includes(r.key));
    if (t.name === 'attachments') {
      for (const r of rows) {
        if (!r.hash && r.blob instanceof Blob) {
          r.hash = await sha256(r.blob);
          suppress++; try { await db.attachments.update(r.id, { hash: r.hash }); } finally { suppress--; }
        }
      }
      rows = rows.map(({ blob, ...rest }) => rest);
    }
    out.tables[t.name] = rows;
  }
  return out;
}

async function applySnapshot(cfg, data) {
  // Reuse blobs we already have (by hash) and download the rest first, so a
  // failed download leaves local data untouched.
  const local = await db.attachments.toArray();
  const byHash = new Map(local.filter((a) => a.hash && a.blob).map((a) => [a.hash, a.blob]));
  const rows = data.tables?.attachments || [];
  let i = 0;
  for (const r of rows) {
    i++;
    if (!r.hash) continue;
    if (byHash.has(r.hash)) { r.blob = byHash.get(r.hash); continue; }
    setStatus('syncing', `Downloading photos ${i}/${rows.length}`);
    const b = await getRaw(cfg, `garage/attachments/${r.hash}`, 'blob');
    if (b) { r.blob = new Blob([b], { type: r.type || 'application/octet-stream' }); byHash.set(r.hash, r.blob); }
  }
  const keep = (await db.settings.toArray()).filter((r) => LOCAL_ONLY_SETTINGS.includes(r.key));
  suppress++;
  try {
    await db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) {
        await t.clear();
        let rs = data.tables[t.name] || [];
        if (t.name === 'settings') rs = [...rs.filter((r) => !LOCAL_ONLY_SETTINGS.includes(r.key)), ...keep];
        if (rs.length) await t.bulkAdd(rs);
      }
    });
  } finally { suppress--; }
}

async function pushSnapshot(cfg, snap, remoteSha) {
  const have = await listAttachmentHashes(cfg);
  const atts = (snap.tables.attachments || []).filter((a) => a.hash && !have.has(a.hash));
  let i = 0;
  for (const a of atts) {
    i++;
    setStatus('syncing', `Uploading photos ${i}/${atts.length}`);
    const row = await db.attachments.get(a.id);
    if (!row?.blob) continue;
    await put(cfg, `garage/attachments/${a.hash}`, await b64FromBlob(row.blob), `Add ${a.kind || 'file'} ${a.name || a.hash.slice(0, 8)}`);
    have.add(a.hash);
  }
  setStatus('syncing', 'Saving records');
  return put(cfg, DATA, await b64FromText(JSON.stringify(snap)), `Sync from ${cfg.device} (${snap.savedAt})`, remoteSha);
}

// ---------- public API ----------
export async function getConfig() {
  const c = await getSetting('sync');
  return c?.token && c?.repo ? { branch: 'main', device: 'device', ...c } : null;
}

export async function saveConfig({ repo, token, device }) {
  repo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo must look like owner/name');
  // Phones sometimes add spaces or line breaks when pasting; tokens never contain them.
  token = String(token || '').replace(/\s+/g, '');
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
    throw new Error(`That doesn't look like a complete GitHub token. Fine-grained tokens start with "github_pat_" and are about 93 characters long (you pasted ${token.length}). Copy it with the copy button next to the token on GitHub; it's only shown once.`);
  }
  const cfg = { repo, token, device: device.trim() || 'device', branch: 'main' };
  const H = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  // 1. Is the token itself valid?
  const me = await fetch(`${API}/user`, { headers: H });
  if (me.status === 401) {
    const why = (await me.json().catch(() => ({}))).message || 'Bad credentials';
    throw new Error(`GitHub rejected the token (401: ${why}). It was mistyped or only partly copied, has expired, or was deleted or regenerated. Make a new token and paste it right away.`);
  }
  const login = me.ok ? (await me.json()).login : null;
  // 2. Can it see the repo?
  const r = await fetch(`${API}/repos/${repo}`, { headers: H });
  if (r.status === 401) throw new Error('GitHub rejected the token (401).');
  if (r.status === 404 || r.status === 403) {
    throw new Error(`The token is valid${login ? ` (signed in as ${login})` : ''} but can't see ${repo}. Check that the repo exists and its name is spelled exactly, then edit the token on GitHub: Repository access → Only select repositories → ${repo.split('/')[1]}, and Permissions → Contents → Read and write.${login && repo.split('/')[0].toLowerCase() !== login.toLowerCase() ? ` The repo owner "${repo.split('/')[0]}" doesn't match your account "${login}".` : ''}`);
  }
  if (!r.ok) throw new Error(`GitHub error ${r.status} checking ${repo}: ${(await r.text()).slice(0, 160)}`);
  const info = await r.json();
  if (!info.private) throw new Error(`${repo} is public. Use a private repo so your records and photos stay private.`);
  cfg.branch = info.default_branch || 'main';
  if (info.permissions && !info.permissions.push) throw new Error('The token can read this repo but not write to it. On GitHub, edit the token: Permissions → Contents → Read and write.');
  await setSetting('sync', cfg);
  await setSetting('syncState', { dirty: true });
  return cfg;
}

export async function disconnect() {
  await setSetting('sync', null);
  await setSetting('syncState', null);
  setStatus('off');
}

// resolveConflict(info) → Promise<'local' | 'remote' | null>
export async function syncNow(opts = {}) {
  const { resolveConflict, onPulled } = opts;
  const cfg = await getConfig();
  if (!cfg) { setStatus('off'); return { action: 'off' }; }
  if (!navigator.onLine) { setStatus('offline', 'Offline, will sync later'); return { action: 'offline' }; }
  if (syncNow.running) return syncNow.running.then((r) => (r.action === 'retry' ? { action: 'none' } : r));
  syncNow.running = (async () => {
    try {
      setStatus('syncing', 'Checking GitHub');
      const state = (await getSetting('syncState')) || {};
      const meta = await getMeta(cfg, DATA);
      const remoteSha = meta?.sha || null;
      const remoteChanged = remoteSha && remoteSha !== state.lastSha;
      let action = 'none';
      if (!remoteSha) action = 'push';
      else if (!remoteChanged) action = state.dirty ? 'push' : 'none';
      else if (!state.dirty || !state.lastSha && (await isEmptyLocal())) action = 'pull';
      else {
        const remote = await readData(cfg, remoteSha);
        const choice = await resolveConflict?.({ remoteSavedAt: remote.savedAt, remoteDevice: remote.device, localDevice: cfg.device });
        if (!choice) { setStatus('conflict', 'Sync paused: choose which copy to keep'); return { action: 'conflict' }; }
        if (choice === 'local') {
          await put(cfg, `garage/conflicts/${Date.now()}-${slug(remote.device || 'other')}.json`, await b64FromText(JSON.stringify(remote)), 'Keep copy of overwritten data');
          action = 'push';
        } else {
          const mine = await snapshot();
          mine.device = cfg.device;
          await put(cfg, `garage/conflicts/${Date.now()}-${slug(cfg.device)}.json`, await b64FromText(JSON.stringify(mine)), 'Keep copy of discarded local data');
          action = 'pull';
        }
      }
      if (action === 'push') {
        const snap = await snapshot();
        snap.device = cfg.device;
        const sha = await pushSnapshot(cfg, snap, remoteSha);
        await setSetting('syncState', { lastSha: sha, dirty: false, lastSync: new Date().toISOString(), lastAction: 'pushed' });
      } else if (action === 'pull') {
        setStatus('syncing', 'Downloading records');
        const remote = await readData(cfg, remoteSha);
        await applySnapshot(cfg, remote);
        await setSetting('syncState', { lastSha: remoteSha, dirty: false, lastSync: new Date().toISOString(), lastAction: `pulled from ${remote.device || 'other device'}` });
        await onPulled?.();
      } else {
        await setSetting('syncState', { ...state, lastSync: new Date().toISOString() });
      }
      setStatus('ok', action === 'push' ? 'Synced (sent)' : action === 'pull' ? 'Synced (received)' : 'Up to date');
      return { action };
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && !opts._retry) return { action: 'retry' }; // remote moved mid-push
      setStatus('error', e.message || String(e));
      return { action: 'error', error: e };
    } finally {
      syncNow.running = null;
    }
  })();
  const r = await syncNow.running;
  // The other device pushed while we were pushing: sync again, which now
  // sees both sides changed and asks which copy to keep.
  if (r.action === 'retry') return syncNow({ ...opts, _retry: true });
  return r;
}

async function isEmptyLocal() {
  return (await db.services.count()) === 0 && (await db.components.count()) === 0;
}
const slug = (s) => String(s).replace(/[^\w]+/g, '-');

let autoOpts = {};
export function startAutoSync(opts) {
  autoOpts = opts;
  installHooks();
  getConfig().then((c) => { if (c) syncNow(autoOpts); else setStatus('off'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(autoOpts); });
  window.addEventListener('online', () => syncNow(autoOpts));
}
function scheduleAutoSync() {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(autoOpts), 15000); // 15 s after the last change
}
export async function syncState() { return (await getSetting('syncState')) || {}; }
