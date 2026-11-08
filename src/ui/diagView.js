// Renders a diagnostics result (from obd/diagnostics.js) and wires its buttons.
import { STATES, flagSeverity } from '../obd/diagnostics.js';
import { inspectionDefs, addFlag } from '../data/repo.js';
import { esc, toast } from './util.js';
import { openTest } from './inspectView.js';

const SEV_DOT = { critical: 'red blink', warn: 'orange', watch: 'yellow' };
const CHECK_DOT = { ok: 'green', watch: 'yellow', warn: 'orange', critical: 'red' };
const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

export function diagnosisHTML(app, res, { compact = false } = {}) {
  if (!res || !res.samples) return '<p class="muted small">No data yet.</p>';
  const tests = new Map(inspectionDefs(app.st.vehicle).tests.map((t) => [t.id, t]));
  const partName = (k) => app.st.parts.find((p) => p.key === k)?.name;
  const states = Object.entries(res.stateCounts).filter(([, n]) => n).map(([k, n]) => `${STATES[k]} ${n}`).join(' · ');
  const f = res.findings;
  const findingsHtml = f.length
    ? `<ul class="list diag-findings">${f.map((x, i) => {
        const parts = x.parts.map(partName).filter(Boolean);
        const ts = x.tests.map((id) => tests.get(id)).filter(Boolean);
        return `<li class="diag-f"><div class="row"><span class="dot lv-${SEV_DOT[x.severity]}"></span><b class="grow">${esc(x.title)}</b><span class="conf conf-${x.confidence}">${CONF_LABEL[x.confidence]}</span></div>
          <p class="small">${esc(x.summary)}</p>
          ${x.evidence.length ? `<ul class="small muted evid">${x.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
          ${x.note ? `<p class="small muted">${esc(x.note)}</p>` : ''}
          ${parts.length ? `<p class="small">Parts: ${esc(parts.join(', '))}</p>` : ''}
          <div class="row wrap">${parts.length ? `<button class="btn small" data-diag-mark="${i}">Mark on car</button>` : ''}${ts.map((t) => `<button class="btn small" data-diag-test="${t.id}">Test: ${esc(t.name)}</button>`).join('')}</div></li>`;
      }).join('')}</ul>${f.some((x) => x.parts.length) ? '<div class="row end"><button class="btn small" data-diag-markall>Mark all on car</button></div>' : ''}`
    : `<p class="small">${res.checks.length ? '<span class="dot lv-green"></span> No problems found in the readings checked.' : 'Not enough data to judge yet.'}</p>`;
  const checksHtml = res.checks.length
    ? `<table class="tbl small diag-checks"><tr><th></th><th>Check</th><th>When</th><th>Reading</th><th>Healthy</th></tr>${res.checks.map((c) => `<tr><td><span class="dot lv-${CHECK_DOT[c.status]}"></span></td><td>${esc(c.label)}</td><td class="muted">${esc(STATES[c.state] || '')}</td><td><b>${esc(c.display)}</b> ${esc(c.unit)}</td><td class="muted">${esc(c.rangeText)} ${esc(c.unit)}</td></tr>`).join('')}</table>`
    : '';
  return `
    <p class="muted small">${res.samples} samples${res.sampleInterval ? ` · every ${res.sampleInterval.toFixed(1)} s` : ''}${states ? ` · ${esc(states)}` : ''}${res.rejected && Object.values(res.rejected).some(Boolean) ? ` · ${Object.values(res.rejected).reduce((a, b) => a + b, 0)} bad reading${Object.values(res.rejected).reduce((a, b) => a + b, 0) > 1 ? 's' : ''} ignored` : ''}</p>
    ${findingsHtml}
    ${checksHtml ? (compact ? `<details class="small"><summary>Healthy-range checks (${res.checks.length}${res.checks.filter((c) => c.status !== 'ok').length ? `, ${res.checks.filter((c) => c.status !== 'ok').length} out of range` : ''})</summary>${checksHtml}</details>` : `<h4>Healthy-range checks</h4>${checksHtml}`) : ''}
    ${res.coverage.length ? `<details class="small" ${res.findings.length || res.checks.length ? '' : 'open'}><summary>For a fuller diagnosis</summary><ul>${res.coverage.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    <p class="muted small">These are likely causes, not proof. Confirm with the linked test before you buy parts.</p>`;
}

// Click handling for a container that holds diagnosisHTML output.
// Returns true if it handled the click.
export async function onDiagClick(app, e, res, { source = 'OBD', onDone } = {}) {
  const mark = e.target.closest('[data-diag-mark],[data-diag-markall]');
  const test = e.target.closest('[data-diag-test]');
  if (test) { onDone?.(); await openTest(app, test.dataset.diagTest); return true; }
  if (!mark) return false;
  const list = mark.dataset.diagMarkall != null ? res.findings : [res.findings[+mark.dataset.diagMark]];
  let n = 0;
  for (const f of list) {
    for (const key of f.parts) {
      const p = app.st.parts.find((x) => x.key === key);
      if (!p) continue;
      await addFlag({ vehicleId: app.st.vehicle.id, partId: p.id, source: 'obd', severity: flagSeverity(f), text: `${f.title} (${CONF_LABEL[f.confidence].toLowerCase()}, ${source})`, code: `diag:${f.id}` });
      n++;
    }
  }
  toast(n ? `Marked ${n} part${n > 1 ? 's' : ''} on the car` : 'No matching parts on this vehicle');
  mark.disabled = true;
  await app.refresh({ keepPanel: true });
  return true;
}
