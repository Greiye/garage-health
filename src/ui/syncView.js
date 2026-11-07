import { getConfig, saveConfig, disconnect, syncNow, syncState, onSyncStatus, startAutoSync } from '../sync/githubSync.js';
import { esc, modal, toast, fmtDate } from './util.js';

// Conflict prompt shared by manual and automatic syncs.
export function resolveConflict(info) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal('Both devices changed', `
      <p>This device (<b>${esc(info.localDevice)}</b>) and <b>${esc(info.remoteDevice || 'another device')}</b> both changed records since the last sync${info.remoteSavedAt ? ` (other copy saved ${esc(new Date(info.remoteSavedAt).toLocaleString())})` : ''}.</p>
      <p class="muted small">Pick which copy to keep. The other one is saved in the repo under <code>garage/conflicts/</code>, and Git history keeps every version.</p>
      <div class="row between"><button class="btn" data-c="remote">Use the synced copy</button><button class="btn primary" data-c="local">Keep this device</button></div>`, {
      onMount: (el, close) => el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { close(); finish(b.dataset.c); })),
    });
    m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('[data-close]')) finish(null); });
  });
}

export const syncOpts = () => ({ resolveConflict, onPulled: async () => { toast('Synced from your other device'); setTimeout(() => location.reload(), 600); } });

export function initSync() {
  startAutoSync(syncOpts());
  const el = document.querySelector('#sync-ind');
  if (el) onSyncStatus((s) => {
    el.hidden = s.state === 'off';
    el.className = `sync-ind st-${s.state}`;
    el.title = s.text || s.state;
    el.textContent = { syncing: '⟳', ok: '✓', error: '!', conflict: '!', offline: '⟳' }[s.state] || '';
  });
  el?.addEventListener('click', () => syncNow(syncOpts()));
}

export async function syncCardHTML() {
  const cfg = await getConfig();
  const st = await syncState();
  if (!cfg) return `<section class="card"><div class="sec-head"><h3>Sync phone ⇄ PC</h3><button class="btn small primary" data-sync="setup">Set up</button></div>
    <p class="muted small">Keeps the phone and PC in step through a private GitHub repo you own, including photos and receipts.</p></section>`;
  return `<section class="card"><div class="sec-head"><h3>Sync phone ⇄ PC</h3><button class="btn small primary" data-sync="now">Sync now</button></div>
    <dl class="kv"><dt>Repo</dt><dd>${esc(cfg.repo)} (private)</dd><dt>This device</dt><dd>${esc(cfg.device)}</dd>
    <dt>Last sync</dt><dd>${st.lastSync ? `${esc(new Date(st.lastSync).toLocaleString())}${st.lastAction ? ` · ${esc(st.lastAction)}` : ''}` : 'never'}</dd>
    <dt>Local changes</dt><dd>${st.dirty ? 'waiting to send' : 'none'}</dd></dl>
    <p class="muted small">Syncs automatically when the app opens and about 15 seconds after you change something.</p>
    <div class="actions"><button class="btn small" data-sync="setup">Change</button><button class="btn small danger" data-sync="off">Disconnect</button></div></section>`;
}

export async function onSyncClick(app, action, rerender) {
  if (action === 'now') {
    const r = await syncNow(syncOpts());
    toast(r.action === 'error' ? `Sync failed: ${r.error.message}` : r.action === 'push' ? 'Sent to GitHub' : r.action === 'pull' ? 'Received from GitHub' : r.action === 'conflict' ? 'Sync paused' : 'Up to date', 4000);
    return rerender();
  }
  if (action === 'off') { await disconnect(); toast('Sync disconnected. Data stays on this device.'); return rerender(); }
  if (action === 'setup') return openSyncSetup(rerender);
}

export async function openSyncSetup(after) {
  const cfg = (await getConfig()) || {};
  const isPhone = /Android|iPhone/i.test(navigator.userAgent);
  modal('Sync with GitHub', `<form class="form">
    <ol class="small steps">
      <li>Create a <b>private</b> repo for your data, for example <a href="https://github.com/new?name=garage-health-data&visibility=private" target="_blank" rel="noopener">garage-health-data</a>. Check "Add a README" so it isn't empty.</li>
      <li>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>. Under Repository access choose "Only select repositories" and pick that repo. Under Permissions set <b>Contents: Read and write</b>. Set an expiry you're happy with.</li>
      <li>Paste the repo and token below. Do the same on your other device with the same token.</li>
    </ol>
    <label>Data repo<input name="repo" value="${esc(cfg.repo || 'Greiye/garage-health-data')}" required placeholder="owner/name"></label>
    <label>Token<input name="token" type="password" value="${esc(cfg.token || '')}" required autocomplete="off" placeholder="github_pat_…"></label>
    <label>Name for this device<input name="device" value="${esc(cfg.device || (isPhone ? 'Phone' : 'PC'))}"></label>
    <p class="muted small">The token is stored only on this device. It is never included in backups, exports or the synced data.</p>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Connect & sync</button></div></form>`, {
    wide: true,
    onSubmit: async (fd) => {
      await saveConfig({ repo: fd.get('repo'), token: fd.get('token'), device: fd.get('device') });
      const r = await syncNow(syncOpts());
      if (r.action === 'error') throw r.error;
      toast(r.action === 'pull' ? 'Connected. Loading your data…' : 'Connected and synced');
      after?.();
    },
  });
}
