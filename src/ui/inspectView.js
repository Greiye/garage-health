import { db } from '../data/db.js';
import { STATUS, measureStatus, evaluateTest } from '../data/inspection.js';
import { inspectionDefs, startInspection, saveInspectionDraft, completeInspection, deleteInspection } from '../data/repo.js';
import { exportInspectionCsv } from './csvExport.js';
import { esc, fmtMi, fmtDate, modal, toast, confirmDialog, num } from './util.js';

// ---------- Inspect tab: 150+ point checklist and test battery ----------
export async function renderInspect(app, el) {
  if (app.inspectionId) {
    const run = await db.inspections.get(app.inspectionId);
    if (run) return renderRun(app, el, run);
    app.inspectionId = null;
  }
  const { st } = app;
  const { items, tests } = inspectionDefs(st.vehicle);
  const runs = st.inspections.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const groups = [...new Set(tests.map((t) => t.group))];
  el.innerHTML = `
    <p class="muted small">${items.length}-point inspection and ${tests.length} tests for this vehicle. Failed or watch items turn the matching parts red or yellow on the model when you finish. Measurements go into each part's history.</p>
    <div class="actions">
      <button class="btn primary" data-act="full">Start ${items.length}-point inspection</button>
      <button class="btn" data-act="tests">Run tests…</button>
      <button class="btn" data-act="everything">Inspection + all tests</button>
    </div>
    <section><h3>Inspections</h3>${runs.length ? `<ul class="list">${runs.map((r) => runRow(r, items)).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</section>
    <section><h3>Test battery</h3>${groups.map((g) => `<details class="sys"><summary><span class="grow">${esc(g)}</span><span class="muted small">${tests.filter((t) => t.group === g).length}</span></summary><ul class="list">${tests.filter((t) => t.group === g).map((t) => `<li class="row-item" data-test="${t.id}"><div class="grow"><div>${esc(t.name)}</div><div class="muted small">${esc(t.criteria)}</div></div><span class="btn small">Run</span></li>`).join('')}</ul></details>`).join('')}</section>`;

  el.onclick = async (e) => {
    const r = e.target.closest('[data-run]');
    if (r) { app.inspectionId = +r.dataset.run; return renderInspect(app, el); }
    const t = e.target.closest('[data-test]');
    if (t) return begin(app, el, { kind: 'tests', testIds: [t.dataset.test], title: tests.find((x) => x.id === t.dataset.test).name });
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'full') return begin(app, el, { kind: 'full', title: `${items.length}-point inspection` });
    if (a === 'everything') return begin(app, el, { kind: 'full', testIds: tests.map((x) => x.id), title: `${items.length}-point inspection + test battery` });
    if (a === 'tests') pickTests(app, el, tests);
  };
}

function runRow(r, items) {
  const res = Object.values(r.results || {});
  const c = (s) => res.filter((x) => x?.status === s).length;
  const nt = Object.keys(r.tests || {}).length;
  const total = (r.kind === 'full' ? items.length : 0) + nt;
  const done = res.filter((x) => x?.status).length + Object.values(r.tests || {}).filter((x) => x?.status || Object.keys(x?.values || {}).length).length;
  return `<li class="row-item" data-run="${r.id}"><span class="dot lv-${r.status === 'done' ? (c('fail') ? 'red' : c('watch') ? 'yellow' : 'green') : 'unknown'}"></span>
    <div class="grow"><div>${esc(r.title)}</div><div class="muted small">${fmtDate(r.date)} · ${fmtMi(r.miles)} · ${r.status === 'done' ? 'Finished' : `Draft ${done}/${total}`}${c('fail') ? ` · ${c('fail')} fail` : ''}${c('watch') ? ` · ${c('watch')} watch` : ''}</div></div></li>`;
}

// Start one test from elsewhere in the app (e.g. a diagnosis).
export async function openTest(app, testId) {
  const t = inspectionDefs(app.st.vehicle).tests.find((x) => x.id === testId);
  if (!t) return;
  app.showTab('inspect');
  await begin(app, null, { kind: 'tests', testIds: [testId], title: t.name });
}

async function begin(app, el, opts) {
  app.inspectionId = await startInspection(app.st.vehicle, opts);
  await app.refresh();
}

function pickTests(app, el, tests) {
  const groups = [...new Set(tests.map((t) => t.group))];
  modal('Choose tests', `<form class="form">
    ${groups.map((g) => `<fieldset><legend>${esc(g)}</legend>${tests.filter((t) => t.group === g).map((t) => `<label class="chk pp-item"><input type="checkbox" name="t" value="${t.id}"> ${esc(t.name)}</label>`).join('')}</fieldset>`).join('')}
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Start</button></div></form>`, {
    onSubmit: async (fd) => {
      const ids = fd.getAll('t');
      if (!ids.length) { toast('Pick at least one test'); return false; }
      await begin(app, el, { kind: 'tests', testIds: ids, title: ids.length === 1 ? tests.find((t) => t.id === ids[0]).name : `${ids.length} tests` });
    },
  });
}

// ---------- One run ----------
function renderRun(app, el, run) {
  const { st } = app;
  const { items, tests } = inspectionDefs(st.vehicle);
  const done = run.status === 'done';
  const partName = new Map(st.allParts.map((p) => [p.key, p.name]));
  const runItems = run.kind === 'full' ? items : [];
  const runTests = tests.filter((t) => run.tests?.[t.id]);
  const secs = [...new Set(runItems.map((i) => i.sec))];
  const filter = app.inspectFilter || 'all';
  const show = (it) => {
    const r = run.results[it.id];
    if (filter === 'open') return !r?.status;
    if (filter === 'problems') return r?.status === 'watch' || r?.status === 'fail';
    return true;
  };
  let timer;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => saveInspectionDraft(run.id, { results: run.results, tests: run.tests, date: run.date, miles: run.miles }), 250); };

  const statusBtns = (cur, attr) => `<span class="seg">${Object.entries(STATUS).map(([k, s]) => `<button type="button" class="seg-b st-${k} ${cur === k ? 'on' : ''}" ${attr} data-st="${k}" ${done ? 'disabled' : ''} title="${s.label}">${s.short}</button>`).join('')}</span>`;
  const partTags = (keys) => keys.filter((k) => partName.has(k)).slice(0, 4).map((k) => `<span class="tag">${esc(partName.get(k))}</span>`).join('');

  const itemHTML = (it) => {
    const r = run.results[it.id] || {};
    return `<li class="insp-item ${r.status ? `has-${r.status}` : ''}" data-item="${it.id}" ${show(it) ? '' : 'hidden'}>
      <div class="row between top"><div class="grow"><div>${esc(it.text)}${it.crit ? ' <span class="crit" title="Safety item">!</span>' : ''}</div>${it.how ? `<div class="muted small">${esc(it.how)}</div>` : ''}<div class="tags">${partTags(it.parts)}</div></div>${statusBtns(r.status, `data-i="${it.id}"`)}</div>
      <div class="row insp-fields">${it.m ? `<label class="mini">${esc(it.m.label)}<span class="row"><input type="number" step="any" inputmode="decimal" data-v="${it.id}" value="${r.value ?? ''}" ${done ? 'disabled' : ''}><span class="muted small">${esc(it.m.unit)}</span></span></label>` : ''}
      <input class="grow note-in" placeholder="Note" data-n="${it.id}" value="${esc(r.note || '')}" ${done ? 'disabled' : ''}></div></li>`;
  };

  const testHTML = (t) => {
    const tr = run.tests[t.id] || { values: {} };
    const ev = evaluateTest(t, tr.values || {});
    const st2 = tr.status || ev.status;
    return `<details class="sys test" data-test-run="${t.id}" ${app.openTests?.has(t.id) ? 'open' : ''}><summary><span class="dot lv-${st2 ? STATUS[st2].level : 'unknown'}"></span><span class="grow">${esc(t.name)}</span><span class="muted small">${esc(t.group)}</span></summary>
      <div class="test-body">
        ${t.tools.length ? `<p class="small"><b>Tools:</b> ${t.tools.map(esc).join(', ')}</p>` : ''}
        <ol class="small steps">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${t.readings.map((r) => {
          const v = tr.values?.[r.id];
          const n = r.count || 1;
          const lim = r.nominal != null && r.limit != null ? ` <span class="muted small">(good ${r.nominal}, limit ${r.limit})</span>` : '';
          return `<div class="reading"><div class="small">${esc(r.label)} <span class="muted">${esc(r.unit)}</span>${lim}</div><div class="reading-grid">${Array.from({ length: n }, (_, i) => `<label class="mini">${r.labels ? esc(r.labels[i]) : ''}<input type="number" step="any" inputmode="decimal" data-tr="${t.id}" data-r="${r.id}" data-k="${r.count ? i : ''}" value="${(r.count ? v?.[i] : v) ?? ''}" ${done ? 'disabled' : ''}></label>`).join('')}</div></div>`;
        }).join('')}
        <p class="small muted"><b>Pass criteria:</b> ${esc(t.criteria)}</p>
        <ul class="small ev" data-ev="${t.id}">${evHTML(ev)}</ul>
        <div class="row between"><span class="small">Result</span>${statusBtns(tr.status, `data-ti="${t.id}"`)}</div>
        <input class="note-in" placeholder="Note" data-tn="${t.id}" value="${esc(tr.note || '')}" ${done ? 'disabled' : ''}>
      </div></details>`;
  };

  const progress = () => {
    const total = runItems.length + runTests.length;
    const n = runItems.filter((i) => run.results[i.id]?.status).length + runTests.filter((t) => run.tests[t.id]?.status || evaluateTest(t, run.tests[t.id]?.values || {}).status).length;
    const res = Object.values(run.results);
    const f = res.filter((x) => x?.status === 'fail').length, w = res.filter((x) => x?.status === 'watch').length;
    return `<div class="prog"><i style="width:${total ? (n / total) * 100 : 0}%"></i></div><div class="muted small">${n} of ${total} done · ${f} fail · ${w} watch</div>`;
  };

  el.innerHTML = `
    <div class="panel-head"><button class="icon-btn" data-back aria-label="Back">←</button><div class="grow"><h2>${esc(run.title)}</h2><div class="muted small">${done ? `Finished ${fmtDate(run.completedAt?.slice(0, 10))}` : 'Draft · saves as you go'}</div></div></div>
    <div class="grid2 form"><label>Date<input type="date" data-date value="${run.date || ''}" ${done ? 'disabled' : ''}></label><label>Odometer<input type="number" data-miles value="${run.miles ?? ''}" ${done ? 'disabled' : ''}></label></div>
    <div data-prog>${progress()}</div>
    ${runItems.length ? `<div class="actions">${['all', 'open', 'problems'].map((f) => `<button class="btn small ${filter === f ? 'primary' : ''}" data-filter="${f}">${{ all: 'All', open: 'Not done', problems: 'Problems' }[f]}</button>`).join('')}
      ${done ? '' : '<button class="btn small" data-act="allok">Mark section OK…</button>'}</div>` : ''}
    ${secs.map((s) => {
      const its = runItems.filter((i) => i.sec === s);
      const n = its.filter((i) => run.results[i.id]?.status).length;
      return `<details class="sys" data-sec="${esc(s)}" ${app.openSecs?.has(s) ? 'open' : ''}><summary><span class="grow">${esc(s)}</span><span class="muted small" data-secn="${esc(s)}">${n}/${its.length}</span></summary><ul class="list insp">${its.map(itemHTML).join('')}</ul></details>`;
    }).join('')}
    ${runTests.length ? `<section><h3>Tests</h3>${runTests.map(testHTML).join('')}</section>` : ''}
    ${done ? '' : `<div class="actions"><button class="btn" data-act="addtest">Add a test</button></div>`}
    <div class="row between">${'<button class="btn danger" data-act="delete">Delete</button>'}<button class="btn" data-act="csv">Export CSV</button>${done ? '' : '<button class="btn primary" data-act="finish">Finish & update health</button>'}</div>`;

  const refreshProg = () => { el.querySelector('[data-prog]').innerHTML = progress(); };
  const refreshSec = (id) => {
    const it = runItems.find((i) => i.id === id);
    if (!it) return;
    const its = runItems.filter((i) => i.sec === it.sec);
    const c = el.querySelector(`[data-secn="${CSS.escape(it.sec)}"]`);
    if (c) c.textContent = `${its.filter((i) => run.results[i.id]?.status).length}/${its.length}`;
  };
  const setItemStatus = (id, status) => {
    run.results[id] = { ...(run.results[id] || {}), status };
    const li = el.querySelector(`[data-item="${id}"]`);
    li.className = `insp-item has-${status}`;
    li.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('on', b.dataset.st === status));
    refreshSec(id);
  };

  el.querySelectorAll('details[data-sec]').forEach((d) => d.addEventListener('toggle', () => { app.openSecs ||= new Set(); d.open ? app.openSecs.add(d.dataset.sec) : app.openSecs.delete(d.dataset.sec); }));
  el.querySelectorAll('details[data-test-run]').forEach((d) => d.addEventListener('toggle', () => { app.openTests ||= new Set(); d.open ? app.openTests.add(d.dataset.testRun) : app.openTests.delete(d.dataset.testRun); }));

  el.oninput = (e) => {
    const t = e.target;
    if (t.dataset.date != null) { run.date = t.value; return save(); }
    if (t.dataset.miles != null) { run.miles = num(t.value); return save(); }
    if (t.dataset.v) {
      const it = runItems.find((i) => i.id === t.dataset.v);
      run.results[it.id] = { ...(run.results[it.id] || {}), value: num(t.value) };
      const auto = measureStatus(it.m, t.value);
      if (auto) setItemStatus(it.id, auto);
      refreshProg();
      return save();
    }
    if (t.dataset.n) { run.results[t.dataset.n] = { ...(run.results[t.dataset.n] || {}), note: t.value }; return save(); }
    if (t.dataset.tn) { run.tests[t.dataset.tn].note = t.value; return save(); }
    if (t.dataset.tr) {
      const tr = run.tests[t.dataset.tr];
      tr.values ||= {};
      if (t.dataset.k !== '') {
        const arr = Array.isArray(tr.values[t.dataset.r]) ? tr.values[t.dataset.r] : [];
        arr[+t.dataset.k] = num(t.value);
        tr.values[t.dataset.r] = arr;
      } else tr.values[t.dataset.r] = num(t.value);
      const test = runTests.find((x) => x.id === t.dataset.tr);
      const ev = evaluateTest(test, tr.values);
      el.querySelector(`[data-ev="${t.dataset.tr}"]`).innerHTML = evHTML(ev);
      const dotEl = el.querySelector(`[data-test-run="${t.dataset.tr}"] summary .dot`);
      const s = tr.status || ev.status;
      dotEl.className = `dot lv-${s ? STATUS[s].level : 'unknown'}`;
      refreshProg();
      return save();
    }
  };

  el.onclick = async (e) => {
    if (e.target.closest('[data-back]')) { app.inspectionId = null; return renderInspect(app, el); }
    const b = e.target.closest('[data-st]');
    if (b && !done) {
      if (b.dataset.i) { const cur = run.results[b.dataset.i]?.status; setItemStatus(b.dataset.i, cur === b.dataset.st ? null : b.dataset.st); }
      if (b.dataset.ti) {
        const tr = run.tests[b.dataset.ti];
        tr.status = tr.status === b.dataset.st ? null : b.dataset.st;
        b.parentElement.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x.dataset.st === tr.status));
        const test = runTests.find((x) => x.id === b.dataset.ti);
        const s = tr.status || evaluateTest(test, tr.values || {}).status;
        el.querySelector(`[data-test-run="${b.dataset.ti}"] summary .dot`).className = `dot lv-${s ? STATUS[s].level : 'unknown'}`;
      }
      refreshProg();
      return save();
    }
    const f = e.target.closest('[data-filter]');
    if (f) { app.inspectFilter = f.dataset.filter; return renderRun(app, el, run); }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'csv') return exportInspectionCsv(app.st, run);
    if (a === 'allok') return markSection(app, el, run, runItems, secs, save);
    if (a === 'addtest') return addTest(app, el, run, tests);
    if (a === 'delete' && (await confirmDialog('Delete this inspection? Flags it already created stay on the parts.', 'Delete'))) {
      await deleteInspection(run.id);
      app.inspectionId = null;
      return app.refresh();
    }
    if (a === 'finish') {
      clearTimeout(timer);
      await saveInspectionDraft(run.id, { results: run.results, tests: run.tests, date: run.date, miles: run.miles });
      const open = runItems.filter((i) => !run.results[i.id]?.status).length;
      if (open && !(await confirmDialog(`${open} items are not checked. They will be left out. Finish anyway?`, 'Finish'))) return;
      const r = await completeInspection(run.id);
      toast(`Done: ${r.flagged} issues flagged, ${r.measures} measurements saved, ${r.passed} parts passed`, 4500);
      await app.refresh();
    }
  };
}

function evHTML(ev) {
  if (!ev.status) return '<li class="muted">Enter readings to evaluate.</li>';
  const notes = ev.notes.length ? ev.notes : [{ status: 'pass', text: 'Readings within limits' }];
  return notes.map((n) => `<li><span class="dot lv-${STATUS[n.status].level}"></span> ${esc(n.text)}</li>`).join('');
}

function markSection(app, el, run, items, secs, save) {
  modal('Mark section OK', `<form class="form"><p class="small muted">Sets every unchecked item in the section to OK. Items you already marked are kept.</p>
    <label>Section<select name="sec">${secs.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Mark OK</button></div></form>`, {
    onSubmit: async (fd) => {
      for (const it of items.filter((i) => i.sec === fd.get('sec'))) if (!run.results[it.id]?.status) run.results[it.id] = { ...(run.results[it.id] || {}), status: 'pass' };
      await saveInspectionDraft(run.id, { results: run.results });
      renderRun(app, el, run);
    },
  });
}

function addTest(app, el, run, tests) {
  const avail = tests.filter((t) => !run.tests[t.id]);
  modal('Add a test', `<form class="form"><label>Test<select name="t">${avail.map((t) => `<option value="${t.id}">${esc(t.group)}: ${esc(t.name)}</option>`).join('')}</select></label>
    <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`, {
    onSubmit: async (fd) => {
      run.tests[fd.get('t')] = { values: {} };
      await saveInspectionDraft(run.id, { tests: run.tests });
      app.openTests ||= new Set();
      app.openTests.add(fd.get('t'));
      renderRun(app, el, run);
    },
  });
}
