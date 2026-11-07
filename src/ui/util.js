export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtMi = (n) => (n == null || n === '' ? '—' : `${Math.round(n).toLocaleString()} mi`);
export const fmtMoney = (n) => (n == null || n === '' || Number.isNaN(+n) ? '' : `$${(+n).toFixed(2)}`);
export const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const num = (v) => (v === '' || v == null ? null : +v);

export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

// Modal dialog. Returns { el, close }. onSubmit gets FormData when a form inside is submitted.
export function modal(title, html, { onMount, onSubmit, wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  const form = wrap.querySelector('form');
  if (form && onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const r = await onSubmit(new FormData(form), form);
        if (r !== false) close();
      } catch (err) {
        console.error(err);
        toast(err.message || String(err), 5000);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  onMount?.(wrap, close);
  return { el: wrap, close };
}

export function confirmDialog(text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const m = modal('Confirm', `<p>${esc(text)}</p><div class="row end"><button class="btn" data-close>Cancel</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`, {
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); }),
    });
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el) resolve(false); });
  });
}

const urlCache = new Map();
export function blobURL(att) {
  if (!urlCache.has(att.id)) urlCache.set(att.id, URL.createObjectURL(att.blob));
  return urlCache.get(att.id);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
