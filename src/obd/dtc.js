// Trouble-code descriptions and the parts each code points at. Generic SAE
// codes only; manufacturer codes (P1xxx) fall back to a range description.

const DESC = {
  P0100: 'MAF circuit malfunction', P0101: 'MAF range/performance', P0102: 'MAF circuit low', P0103: 'MAF circuit high',
  P0106: 'MAP/baro range/performance', P0107: 'MAP circuit low', P0108: 'MAP circuit high',
  P0110: 'IAT circuit malfunction', P0112: 'IAT circuit low', P0113: 'IAT circuit high',
  P0115: 'ECT circuit malfunction', P0116: 'ECT range/performance', P0117: 'ECT circuit low', P0118: 'ECT circuit high',
  P0120: 'TPS circuit malfunction', P0121: 'TPS range/performance', P0122: 'TPS circuit low', P0123: 'TPS circuit high',
  P0125: 'Insufficient coolant temp for closed loop', P0128: 'Coolant below thermostat regulating temp',
  P0130: 'O2 B1S1 circuit', P0131: 'O2 B1S1 low voltage', P0132: 'O2 B1S1 high voltage', P0133: 'O2 B1S1 slow response', P0135: 'O2 B1S1 heater circuit',
  P0136: 'O2 B1S2 circuit', P0137: 'O2 B1S2 low voltage', P0138: 'O2 B1S2 high voltage', P0141: 'O2 B1S2 heater circuit',
  P0150: 'O2 B2S1 circuit', P0151: 'O2 B2S1 low voltage', P0152: 'O2 B2S1 high voltage', P0153: 'O2 B2S1 slow response', P0155: 'O2 B2S1 heater circuit',
  P0156: 'O2 B2S2 circuit', P0157: 'O2 B2S2 low voltage', P0158: 'O2 B2S2 high voltage', P0161: 'O2 B2S2 heater circuit',
  P0171: 'System too lean bank 1', P0172: 'System too rich bank 1', P0174: 'System too lean bank 2', P0175: 'System too rich bank 2',
  P0230: 'Fuel pump primary circuit',
  P0300: 'Random/multiple cylinder misfire', P0301: 'Cylinder 1 misfire', P0302: 'Cylinder 2 misfire', P0303: 'Cylinder 3 misfire',
  P0304: 'Cylinder 4 misfire', P0305: 'Cylinder 5 misfire', P0306: 'Cylinder 6 misfire', P0307: 'Cylinder 7 misfire', P0308: 'Cylinder 8 misfire',
  P0316: 'Misfire on startup', P0320: 'Ignition/distributor engine speed input circuit', P0325: 'Knock sensor 1 circuit', P0335: 'Crankshaft position sensor A circuit',
  P0340: 'Camshaft position sensor circuit', P0350: 'Ignition coil primary/secondary circuit', P0351: 'Ignition coil A circuit', P0352: 'Ignition coil B circuit', P0353: 'Ignition coil C circuit',
  P0400: 'EGR flow malfunction', P0401: 'EGR flow insufficient', P0402: 'EGR flow excessive', P0405: 'EGR sensor A circuit low', P0406: 'EGR sensor A circuit high',
  P0420: 'Catalyst efficiency below threshold bank 1', P0430: 'Catalyst efficiency below threshold bank 2',
  P0440: 'EVAP system malfunction', P0442: 'EVAP small leak', P0443: 'EVAP purge valve circuit', P0446: 'EVAP vent control', P0455: 'EVAP large leak', P0456: 'EVAP very small leak', P0457: 'EVAP leak (fuel cap loose/off)',
  P0460: 'Fuel level sensor circuit', P0500: 'Vehicle speed sensor', P0505: 'Idle air control system', P0506: 'Idle RPM lower than expected', P0507: 'Idle RPM higher than expected',
  P0562: 'System voltage low', P0563: 'System voltage high', P0603: 'PCM keep-alive memory error', P0605: 'PCM ROM error',
  P0700: 'Transmission control system', P0703: 'Brake switch input', P0705: 'Trans range sensor', P0715: 'Turbine speed sensor', P0720: 'Output speed sensor', P0730: 'Incorrect gear ratio', P0740: 'Torque converter clutch circuit',
  P1000: 'OBD monitors not complete (Ford: normal after battery disconnect)', P1131: 'Lack of upstream O2 switching B1 (lean)', P1151: 'Lack of upstream O2 switching B2 (lean)',
  P1400: 'DPFE sensor circuit low', P1401: 'DPFE sensor circuit high', P1405: 'DPFE upstream hose off/plugged', P1406: 'DPFE downstream hose off/plugged',
  P1443: 'EVAP purge flow sensor', P1450: 'Unable to bleed up fuel tank vacuum', P1506: 'IAC overspeed', P1507: 'IAC underspeed',
};

// Code (or prefix) → part keys
const MAP = [
  [/^P010[0-4]/, ['maf', 'air_filter']],
  [/^P010[5-9]/, ['intake']],
  [/^P011[0-4]/, ['air_filter']],
  [/^P011[5-9]|^P0125|^P0128/, ['thermostat', 'coolant']],
  [/^P012[0-4]/, ['throttle_body']],
  [/^P013[0-5]|^P1131/, ['o2_up_1']],
  [/^P013[6-9]|^P014/, ['o2_down_1']],
  [/^P015[0-5]|^P1151/, ['o2_up_2']],
  [/^P015[6-9]|^P016/, ['o2_down_2']],
  [/^P0171|^P0174/, ['intake_gasket', 'maf', 'fuel_filter', 'fuel_pump', 'pcv']],
  [/^P0172|^P0175/, ['maf', 'injectors', 'o2_up_1', 'o2_up_2']],
  [/^P023/, ['fuel_pump']],
  [/^P030[0-9]|^P0316/, ['plugs', 'plug_wires', 'coils', 'injectors']],
  [/^P0320|^P0335/, ['crank_sensor']],
  [/^P0340/, ['cam_sensor']],
  [/^P035/, ['coils']],
  [/^P040|^P140[0-6]/, ['egr']],
  [/^P0420/, ['cat_1', 'o2_down_1']],
  [/^P0430/, ['cat_2', 'o2_down_2']],
  [/^P04[45]|^P1443|^P1450/, ['evap']],
  [/^P0460/, ['fuel_tank']],
  [/^P0500/, ['transmission']],
  [/^P050[5-7]|^P150[67]/, ['throttle_body']],
  [/^P056[23]/, ['alternator', 'battery']],
  [/^P07/, ['transmission', 'trans_fluid']],
];

export function describeDtc(code) {
  if (DESC[code]) return DESC[code];
  const sys = { P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' }[code[0]] || '';
  const mfr = code[1] === '1' || code[1] === '3' ? 'manufacturer-specific' : 'generic';
  const area = { 1: 'fuel/air metering', 2: 'fuel/air metering (injector circuit)', 3: 'ignition/misfire', 4: 'emission controls', 5: 'speed/idle control', 6: 'computer/output circuit', 7: 'transmission', 8: 'transmission' }[code[2]] || '';
  return `${sys} ${mfr} code${area ? `, ${area}` : ''}`;
}

export function partsForDtc(code) {
  for (const [re, parts] of MAP) if (re.test(code)) return parts;
  return [];
}

export function dtcSeverity(code) {
  if (/^P030/.test(code)) return 'critical'; // misfires can kill cats
  if (code === 'P1000') return 'watch';
  return 'warn';
}

// Parse a mode 03/07/0A response into codes. Handles CAN (with count byte)
// and J1850/ISO (no count byte), multi-ECU lines and padding zeros.
export function parseDtcResponse(raw, mode = '43', isCan = false) {
  const lines = raw.split(/[\r\n]+/).map((l) => l.replace(/\s|>/g, '').toUpperCase()).filter(Boolean);
  const codes = new Set();
  for (let line of lines) {
    if (/NODATA|SEARCHING|ERROR|UNABLE/.test(line)) continue;
    line = line.replace(/^[0-9A-F]:/, ''); // multi-frame CAN index
    const idx = line.indexOf(mode);
    if (idx !== 0) continue;
    let data = line.slice(2);
    if (isCan) data = data.slice(2);
    for (let i = 0; i + 4 <= data.length; i += 4) {
      const c = decodeDtc(data.slice(i, i + 4));
      if (c) codes.add(c);
    }
  }
  return [...codes];
}

export function decodeDtc(hex4) {
  if (!/^[0-9A-F]{4}$/.test(hex4) || hex4 === '0000') return null;
  const n = parseInt(hex4, 16);
  const sys = 'PCBU'[(n >> 14) & 3];
  return `${sys}${(n >> 12) & 3}${hex4.slice(1)}`;
}
