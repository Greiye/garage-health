// Check whether the car answers manufacturer extended PIDs (Mode 22, "read
// data by identifier"), before the app adds any Ford-specific PIDs.
//
// We send a few requests to the engine computer and look only at what kind of
// reply comes back, not at the data:
//   62 ...         positive reply: the module answers Mode 22 and this ID
//   7F 22 ... NRC  negative reply: the module understands Mode 22 but refuses
//                  this ID (NRC 11 = Mode 22 itself is not supported)
//   NO DATA / ? / timeout: no answer
// A positive or negative-but-understood reply means extended PIDs are worth
// adding for this car. Nothing is decoded, written or cleared.
//
// Mode 22 usually needs the request addressed to the PCM directly (physical
// header) instead of the generic OBD broadcast, so each ID is tried both ways.
// The default header is restored afterwards. The live poller must be stopped
// while this runs, since header changes would affect its requests too.

// Probe IDs. They are probes, not decoded values: any reply type tells us
// whether the module speaks Mode 22.
export const PROBE_DIDS = ['1100', '1172', '1E1C', 'F190'];

// Headers by ELM327 protocol number (ATDPN, without the A prefix).
// phys = engine computer (PCM) direct, def = the adapter's default for that protocol.
const HEADERS = {
  1: { name: 'J1850 PWM (Ford)', phys: 'C410F1', def: '616AF1' },
  2: { name: 'J1850 VPW', phys: '6C10F1', def: '686AF1' },
  6: { name: 'CAN 11-bit 500k', phys: '7E0', def: '7DF' },
  8: { name: 'CAN 11-bit 250k', phys: '7E0', def: '7DF' },
  7: { name: 'CAN 29-bit 500k', phys: 'DA10F1', def: 'DB33F1' },
  9: { name: 'CAN 29-bit 250k', phys: 'DA10F1', def: 'DB33F1' },
};

// Classify one reply. Returns { verdict: 'positive' | 'negative' | 'unsupported' | 'none', nrc }
export function classify(reply, did) {
  const lines = String(reply || '').toUpperCase().split(/[\r\n]+/).map((l) => l.replace(/\s/g, ''));
  for (const h of lines) {
    if (h.includes('62' + did)) return { verdict: 'positive' };
    const i = h.indexOf('7F22');
    if (i !== -1) {
      const nrc = h.slice(-2); // last byte: UDS "7F 22 31", Ford SCP echoes the ID first ("7F 22 11 00 31")
      return { verdict: nrc === '11' ? 'unsupported' : 'negative', nrc };
    }
  }
  return { verdict: 'none' };
}

export const answered = (results) => results.some((r) => r.verdict === 'positive' || r.verdict === 'negative');

// elm: connected Elm327 with the poller stopped. Returns a result to store on the vehicle.
export async function probeMode22(elm) {
  const dpn = String(await elm.cmd('ATDPN').catch(() => '')).trim().replace(/^A/i, '');
  const hdr = HEADERS[dpn.slice(-1)];
  const results = [];
  const tries = [{ header: null, label: 'OBD broadcast' }, ...(hdr ? [{ header: hdr.phys, label: `PCM direct (${hdr.phys})` }] : [])];
  try {
    for (const t of tries) {
      if (t.header) await elm.cmd('ATSH' + t.header);
      for (const did of PROBE_DIDS) {
        const req = '22' + did;
        let reply;
        try { reply = await elm.cmd(req, 3000); } catch (e) { reply = `(${e.message || e})`; }
        results.push({ via: t.label, req, reply: String(reply).slice(0, 80), ...classify(reply, did) });
      }
    }
  } finally {
    if (hdr) await elm.cmd('ATSH' + hdr.def).catch(() => {});
  }
  return {
    checkedAt: new Date().toISOString(),
    protocol: hdr?.name || elm.protocol || `protocol ${dpn || '?'}`,
    answered: answered(results),
    results,
  };
}

export function mode22Summary(m) {
  if (!m) return 'Not checked yet';
  if (m.answered) {
    const pos = m.results.filter((r) => r.verdict === 'positive').length;
    return `The car answers Mode 22 (${pos ? `${pos} positive replies` : 'refused the probe IDs, but understands the request'}) · ${m.protocol}`;
  }
  return `No answer to Mode 22 · ${m.protocol}. Extended Ford PIDs stay off.`;
}
