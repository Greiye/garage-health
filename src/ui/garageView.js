import { getCustomModel, saveCustomModel, removeCustomModel } from '../scene/customModel.js';
import { syncCardHTML, onSyncClick, openSyncSetup } from './syncView.js';
import { db, setSetting, exportBackup, importBackup, todayISO } from '../data/db.js';
import { createVehicle, applyOptions, setOdometer } from '../data/repo.js';
import { PRESETS, OPTION_FIELDS, SYSTEMS } from '../data/templates.js';
import { exportServicesCsv, exportPartsCsv, exportTiresCsv, exportCostsCsv } from './csvExport.js';
import { esc, fmtMi, fmtDate, modal, toast, confirmDialog, download, num } from './util.js';

export async function renderGarage(app, el) {
  const vehicles = await db.vehicles.toArray();
  const v = app.st.vehicle;
  const odo = (await db.odometer.where({ vehicleId: v.id }).toArray()).sort((a, b) => (a.date < b.date ? 1 : -1));
  const hidden = app.st.allParts.filter((p) => p.hidden);
  const syncCard = await syncCardHTML();
  const cm = await getCustomModel(v.id).catch(() => null);
  el.innerHTML = `
  <section class="card"><div class="sec-head"><h3>Vehicles</h3><button class="btn small primary" data-act="add">Add vehicle</button></div>
    <ul class="list">${vehicles.map((x) => `<li class="row-item ${x.id === v.id ? 'current' : ''}" data-vehicle="${x.id}"><span class="swatch" style="background:${esc(x.bodyColor)}"></span><div class="grow"><div>${esc(x.name)}</div><div class="muted small">${esc([x.engine, x.transmission].filter(Boolean).join(' · '))} · ${fmtMi(x.odometer)}</div></div>${x.id === v.id ? '<span class="muted small">current</span>' : '<span>›</span>'}</li>`).join('')}</ul>
  </section>

  <section class="card"><div class="sec-head"><h3>${esc(v.name)}</h3><button class="btn small" data-act="edit">Edit</button></div>
    <dl class="kv">${[['Year', v.year], ['Make', v.make], ['Model', v.model], ['Trim', v.trim], ['Engine', v.engine], ['Transmission', v.transmission], ['VIN', v.vin], ['Odometer', fmtMi(v.odometer)]].filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
    <details class="small"><summary>Configuration (decides which parts exist)</summary><dl class="kv">${OPTION_FIELDS.map(([k, label]) => `<dt>${label}</dt><dd>${esc(String(v.options?.[k]))}</dd>`).join('')}</dl></details>
  </section>

  <section class="card"><h3>3D model</h3>
    <p class="small">${cm ? `Using <b>${esc(cm.name)}</b> (${(cm.size / 1048576).toFixed(1)} MB). Wheels show tire health, calipers show brake health; tap X-ray to see every other part inside.` : 'Using the built-in model.'}</p>
    <p class="muted small">Load your own .glb model for this vehicle. It's saved on this device only: not synced, not in backups, so import it on each device. Front, size and wheels are fitted automatically.</p>
    <div class="actions"><label class="btn file-btn">${cm ? 'Replace model' : 'Use my own 3D model'}<input type="file" accept=".glb,model/gltf-binary,application/octet-stream" data-model hidden></label>${cm ? '<button class="btn" data-act="model-reset">Use built-in model</button>' : ''}</div>
  </section>

  <section class="card"><div class="sec-head"><h3>Odometer</h3><button class="btn small" data-act="odo">Update</button></div>
    <ul class="list compact">${odo.slice(0, 8).map((o) => `<li class="row-item"><span class="grow">${fmtDate(o.date)}</span><span>${fmtMi(o.miles)}</span><span class="muted small">${esc(o.source)}</span></li>`).join('')}</ul>
  </section>

  <section class="card"><div class="sec-head"><h3>Parts</h3><button class="btn small" data-act="custom">Add custom part</button></div>
    <p class="muted small">${app.st.parts.length} tracked parts. Edit any part's intervals from its page.</p>
    ${hidden.length ? `<details class="small"><summary>Hidden parts (${hidden.length})</summary><ul class="list compact">${hidden.map((p) => `<li class="row-item"><span class="grow">${esc(p.name)}</span><button class="btn small" data-unhide="${p.id}">Restore</button></li>`).join('')}</ul></details>` : ''}
  </section>

  ${syncCard}
  <section class="card"><h3>Backup</h3>
    <p class="muted small">Everything is stored on this device. Export a full backup (including photos and receipts) to move it or keep it safe.</p>
    <div class="actions"><button class="btn" data-act="export">Export backup</button><label class="btn file-btn">Restore backup<input type="file" accept="application/json,.json" data-import hidden></label></div>
  </section>
  <section class="card"><h3>Export CSV</h3>
    <p class="muted small">Spreadsheets for Excel or Google Sheets. OBD sessions and inspections export from their own screens.</p>
    <div class="actions"><button class="btn" data-csv-x="services">Service log</button><button class="btn" data-csv-x="parts">Parts & health</button><button class="btn" data-csv-x="tires">Tires</button><button class="btn" data-csv-x="costs">Costs by year</button></div>
  </section>
  <section class="card danger-zone"><button class="btn danger small" data-act="delete">Delete ${esc(v.name)}</button></section>`;

  el.onclick = async (e) => {
    const t = e.target.closest('[data-act],[data-vehicle],[data-unhide],[data-csv-x],[data-sync]');
    if (t?.dataset.sync) return onSyncClick(app, t.dataset.sync, () => renderGarage(app, el));
    if (!t) return;
    if (t.dataset.vehicle) { await setSetting('currentVehicle', +t.dataset.vehicle); return app.loadVehicle(+t.dataset.vehicle); }
    if (t.dataset.unhide) { await db.parts.update(+t.dataset.unhide, { hidden: false, userHidden: false }); return app.refresh(); }
    if (t.dataset.csvX) return ({ services: exportServicesCsv, parts: exportPartsCsv, tires: exportTiresCsv, costs: exportCostsCsv })[t.dataset.csvX](app.st);
    const a = t.dataset.act;
    if (a === 'add') openVehicleWizard(app);
    if (a === 'edit') openVehicleEdit(app);
    if (a === 'odo') openOdometer(app);
    if (a === 'model-reset') { await removeCustomModel(v.id); app.viewer.setVehicle(v.options, v.bodyColor, v.id); toast('Built-in model'); return renderGarage(app, el); }
    if (a === 'custom') openCustomPart(app);
    if (a === 'export') { download(await exportBackup(), `garage-health-backup-${todayISO()}.json`); toast('Backup exported'); }
    if (a === 'delete') {
      if (!(await confirmDialog(`Delete ${v.name} and all of its history, photos and receipts? Export a backup first if unsure.`, 'Delete vehicle'))) return;
      for (const t2 of ['parts', 'components', 'services', 'attachments', 'flags', 'obdSessions', 'dtcs', 'odometer']) await db[t2].where({ vehicleId: v.id }).delete();
      await db.vehicles.delete(v.id);
      const next = await db.vehicles.toCollection().first();
      if (next) app.loadVehicle(next.id); else location.reload();
    }
  };
  el.querySelector('[data-model]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    toast('Loading model…');
    try {
      await saveCustomModel(v.id, f);
      app.viewer.setVehicle(v.options, v.bodyColor, v.id);
      toast(`3D model saved on this device (${(f.size / 1048576).toFixed(1)} MB)`);
    } catch (err) { toast(err.message, 6000); }
    renderGarage(app, el);
  };
  el.querySelector('[data-import]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !(await confirmDialog('Restoring replaces everything on this device with the backup. Continue?', 'Restore'))) return;
    try { await importBackup(f); toast('Backup restored'); location.reload(); } catch (err) { toast(err.message, 6000); }
  };
}

export function openOdometer(app) {
  const v = app.st.vehicle;
  modal('Update odometer', `<form class="form"><div class="grid2">
    <label>Miles<input type="number" name="miles" value="${v.odometer ?? ''}" required inputmode="numeric" autofocus></label>
    <label>Date<input type="date" name="date" value="${todayISO()}"></label></div>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    onSubmit: async (fd) => {
      const m = +fd.get('miles');
      if (v.odometer != null && m < v.odometer && !(await confirmDialog(`${m.toLocaleString()} is lower than the current ${v.odometer.toLocaleString()}. Save anyway as a history entry?`, 'Save'))) return false;
      await setOdometer(v.id, m, fd.get('date'));
      await app.refresh();
    },
  });
}

function optionInputs(opts) {
  return `<div class="grid3">${OPTION_FIELDS.map(([k, label, values]) => `<label>${label}<select name="opt_${k}">${values.map((x) => `<option value="${x}" ${String(opts[k]) === String(x) ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`).join('')}</div>`;
}
function readOptions(fd, base) {
  const o = { ...base };
  for (const [k, , values] of OPTION_FIELDS) {
    const raw = fd.get(`opt_${k}`);
    const match = values.find((x) => String(x) === raw);
    if (match !== undefined) o[k] = match;
  }
  return o;
}
const vehicleFields = (v) => `<div class="grid3">
  <label>Year<input name="year" type="number" value="${esc(v.year ?? '')}"></label>
  <label>Make<input name="make" value="${esc(v.make ?? '')}"></label>
  <label>Model<input name="model" value="${esc(v.model ?? '')}"></label>
  <label>Trim<input name="trim" value="${esc(v.trim ?? '')}"></label>
  <label>Engine<input name="engine" value="${esc(v.engine ?? '')}"></label>
  <label>Transmission<input name="transmission" value="${esc(v.transmission ?? '')}"></label>
  <label>VIN<input name="vin" value="${esc(v.vin ?? '')}" maxlength="17"></label>
  <label>Body color<input name="bodyColor" type="color" value="${esc(v.bodyColor || '#888888')}"></label>
  <label>Nickname<input name="name" value="${esc(v.name ?? '')}" placeholder="optional"></label></div>`;
const readVehicle = (fd) => ({ year: num(fd.get('year')), make: fd.get('make').trim(), model: fd.get('model').trim(), trim: fd.get('trim').trim(), engine: fd.get('engine').trim(), transmission: fd.get('transmission').trim(), vin: fd.get('vin').trim().toUpperCase(), bodyColor: fd.get('bodyColor') });

export function openVehicleWizard(app, { first = false } = {}) {
  const preset0 = PRESETS[0];
  modal(first ? 'Set up your first vehicle' : 'Add vehicle', `<form class="form">
    <label>Start from<select name="preset">${PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
    <div data-vfields>${vehicleFields(preset0.vehicle)}</div>
    <div class="grid2"><label>Current odometer (mi)<input type="number" name="odometer" required inputmode="numeric" value="${first ? 180200 : ''}"></label></div>
    <details><summary>Configuration</summary><p class="muted small">Decides which parts exist and how the 3D model is built. Change later in Garage.</p><div data-opts>${optionInputs(preset0.options)}</div></details>
    <div class="row ${first ? 'between' : 'end'}">${first ? '<button class="btn" type="button" data-from-sync>Already using it on another device? Sync from GitHub</button>' : '<button class="btn" type="button" data-close>Cancel</button>'}<button class="btn primary" type="submit">Create</button></div></form>`, {
    wide: true,
    onMount: (root, close) => { root.querySelector('[data-from-sync]')?.addEventListener('click', () => { close(); openSyncSetup(() => location.reload()); }); root.querySelector('[name=preset]').addEventListener('change', (e) => {
      const p = PRESETS.find((x) => x.id === e.target.value);
      root.querySelector('[data-vfields]').innerHTML = vehicleFields(p.vehicle);
      root.querySelector('[data-opts]').innerHTML = optionInputs(p.options);
    }); },
    onSubmit: async (fd) => {
      const p = PRESETS.find((x) => x.id === fd.get('preset'));
      const vehicle = readVehicle(fd);
      const id = await createVehicle({ presetId: p.id, name: fd.get('name').trim() || undefined, vehicle, options: readOptions(fd, p.options), odometer: num(fd.get('odometer')) });
      await app.loadVehicle(id);
      toast('Vehicle created. Tap any part to add its history.');
    },
  });
}

function openVehicleEdit(app) {
  const v = app.st.vehicle;
  modal(`Edit ${v.name}`, `<form class="form">${vehicleFields(v)}
    <details><summary>Configuration</summary><p class="muted small">Parts that no longer apply are hidden, not deleted.</p>${optionInputs(v.options)}</details>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, {
    wide: true,
    onSubmit: async (fd) => {
      const upd = readVehicle(fd);
      upd.name = fd.get('name').trim() || [upd.year, upd.make, upd.model].filter(Boolean).join(' ') || v.name;
      await db.vehicles.update(v.id, upd);
      const opts = readOptions(fd, v.options);
      if (JSON.stringify(opts) !== JSON.stringify(v.options)) await applyOptions(v.id, opts);
      await app.loadVehicle(v.id);
    },
  });
}

function openCustomPart(app) {
  const slots = [...app.viewer.model.slots.keys()].sort();
  modal('Add custom part', `<form class="form">
    <label>Name<input name="name" required placeholder="Aftermarket clutch quadrant, catch can, coilovers…"></label>
    <div class="grid2"><label>System<select name="system">${SYSTEMS.map((s) => `<option>${s}</option>`).join('')}</select></label>
    <label>Show on 3D model at<select name="slot">${slots.map((s) => `<option value="${s}">${esc(app.viewer.label(s))} (${s})</option>`).join('')}</select></label>
    <label>Interval (miles)<input type="number" name="im"></label><label>Interval (months)<input type="number" name="mo"></label>
    <label>Max age (months)<input type="number" name="age"></label></div>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`, {
    onSubmit: async (fd) => {
      await db.parts.add({ vehicleId: app.st.vehicle.id, key: `custom_${Date.now()}`, custom: true, name: fd.get('name').trim(), system: fd.get('system'), slot: fd.get('slot'), im: num(fd.get('im')) || 0, mo: num(fd.get('mo')) || 0, age: num(fd.get('age')) || 0, notes: '' });
      await app.refresh();
    },
  });
}
