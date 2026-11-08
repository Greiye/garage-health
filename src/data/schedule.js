// Preventive maintenance schedule. A replace interval missing on the Normal
// schedule but given for Severe (rear axle lube) applies only to Severe.
//
// For every part this gives a replace/service interval and an inspect
// interval, each as [miles, months] (whichever comes first; 0 = not used),
// for the Normal and Severe schedules. Values follow common owner-manual
// guidance for gasoline cars; Ford's 2001 schedule is used where noted. A
// vehicle catalog can override entries (catalog.schedule), and anything the
// user sets on a part wins over both.
//
// Severe service (Ford's "special operating conditions"): mostly short trips
// under 10 miles, freezing temperatures, extended idling or stop-and-go,
// towing, dusty or muddy roads.

import { VEHICLE_CATALOGS } from './catalogs/index.js';

export const MODES = {
  normal: { label: 'Normal', hint: 'Mostly highway or mixed driving, mild weather.' },
  severe: { label: 'Severe', hint: 'Mostly short trips (under 10 mi), freezing temps, lots of idling or stop-and-go, towing, or dusty roads.' },
};

const LEAK_CHECK = 'Look for oil or coolant seepage and wetness';
// r: replace/service [mi, mo] · rs: severe replace · i: inspect · is: severe inspect
// l: typical life [mi, mo] (no factory interval; past it the part goes yellow / Watch)
// src: 'Ford' = Ford Scheduled Maintenance Guide for the SN95 Mustang (1998 edition,
//      same platform and 3.8 engine); otherwise general manual / industry guidance.
export const PM = {
  // ---- Engine ----
  engine: { i: [5000, 6], is: [3000, 3], what: 'Leaks, noises, oil use between changes' },
  intake_gasket: { i: [5000, 6], is: [3000, 3], l: [100000, 120], what: `${LEAK_CHECK} at the intake; watch coolant level and fuel trims` },
  valve_cover_gaskets: { i: [5000, 6], is: [3000, 3], l: [100000, 96], what: `${LEAK_CHECK} along the valve covers and in the plug wells` },
  head_gaskets: { i: [15000, 12], what: 'Coolant loss, white exhaust, milky oil' },
  oil_pan_gasket: { i: [5000, 6], is: [3000, 3], l: [150000, 144], what: `${LEAK_CHECK} at the pan rail and drain plug` },
  front_cover: { i: [5000, 6], is: [3000, 3], l: [100000, 120], what: `${LEAK_CHECK} at the timing cover and crank seal` },
  rear_main_seal: { i: [5000, 6], is: [3000, 3], l: [150000, 144], what: 'Oil drips at the bellhousing seam' },
  timing: { i: [60000, 0], l: [150000, 0], what: 'Chain slap or rattle at cold start' },
  pcv: { r: [100000, 0], i: [30000, 24], src: 'Ford', what: 'Valve rattles when shaken; hoses not cracked or soft', note: 'Ford lists PCV replacement at 100,000 mi for the 3.8.' },
  engine_mount: { i: [30000, 24], l: [100000, 120], what: 'Cracked or collapsed rubber, engine lift under throttle' },
  cam_sensor: { i: [60000, 0], what: 'Connector and wiring' },
  crank_sensor: { i: [60000, 0], what: 'Connector and wiring' },
  // ---- Lubrication ----
  oil: { r: [5000, 6], rs: [3000, 3], src: 'Ford', note: 'Ford: every 5,000 mi (Normal) or 3,000 mi (Severe). The 6 / 3 month limits are general guidance for low-mileage use. Check the dipstick every few fill-ups.' },
  // ---- Cooling ----
  coolant: { r: [30000, 36], i: [15000, 12], src: 'Ford', what: 'Level (cold), color, freeze strength', note: 'Ford: first change at 50,000 mi / 48 months, then every 30,000 mi / 36 months.' },
  radiator: { i: [15000, 12], src: 'Ford', what: 'Fins clear, no leaks at tanks or seams' },
  hoses: { i: [15000, 12], l: [100000, 120], src: 'Ford', what: 'Squeeze when cold: replace if soft, swollen, cracked or crunchy; clamps tight' },
  thermostat: { i: [15000, 12], l: [100000, 120], what: 'Warms up in about 10 min and holds near 195°F' },
  water_pump: { i: [15000, 12], l: [100000, 120], what: 'Weep hole dry, no shaft play or bearing noise' },
  fan: { i: [15000, 12], what: 'Comes on at temperature and with A/C' },
  rad_cap: { i: [15000, 12], l: [0, 72], what: 'Seal not cracked; pressure test' },
  heater_core: { i: [0, 12], what: 'Heat output, sweet smell or foggy windshield' },
  ac_system: { i: [0, 12], what: 'Vent temperature, compressor engages, no oily spots' },
  belt: { i: [30000, 24], l: [90000, 96], src: 'Ford', what: 'Cracks, glazing, missing chunks, squeal', note: 'Ford schedules belt inspection only (from 60,000 mi, then every 30,000).' },
  tensioner: { i: [30000, 24], l: [100000, 120], what: 'Arm steady at idle, pulley bearing quiet' },
  // ---- Ignition ----
  plugs: { r: [100000, 0], rs: [60000, 0], src: 'Ford' },
  plug_wires: { i: [30000, 24], l: [100000, 120], what: 'Cracks, burns, arcing in the dark' },
  coils: { i: [30000, 24], what: 'Cracks or carbon tracking on the coil pack' },
  // ---- Fuel / air ----
  fuel_filter: { r: [30000, 0], note: 'Ford\'s schedule doesn\'t list it; 30,000 mi is the common recommendation for this inline filter.' },
  fuel_pump: { i: [30000, 0], what: 'Fuel pressure, whine from the tank' },
  injectors: { i: [30000, 0], what: 'Fuel trims, misfire counts' },
  fuel_tank: { i: [0, 12], what: 'Straps, filler neck, fuel smell' },
  air_filter: { r: [30000, 36], i: [15000, 12], is: [5000, 6], src: 'Ford', what: 'Hold to light; replace early if dark or clogged', note: 'Ford: replace every 30,000 mi on both schedules; more often on dusty roads.' },
  maf: { r: [30000, 36], what: 'Clean the sensing wire with MAF cleaner' },
  throttle_body: { r: [30000, 36], what: 'Clean the bore and idle air control valve' },
  cabin_filter: { r: [15000, 12], rs: [10000, 12] },
  // ---- Electrical ----
  battery: { i: [0, 12], l: [0, 60], what: 'Load test; terminals clean and tight' },
  alternator: { i: [0, 12], what: 'Charging 13.5–14.7 V, no whine' },
  starter: { i: [0, 12], what: 'Cranks strong, no grinding' },
  // ---- Drivetrain ----
  clutch: { i: [15000, 12], what: 'Engagement point, slip in high gear under load' },
  clutch_cable: { i: [5000, 6], is: [3000, 3], src: 'Ford', what: 'Lift the clutch pedal by hand to let the self-adjuster ratchet (cable clutch); check engagement height', note: 'Ford: adjust the clutch by lifting the pedal every 5,000 mi (3,000 severe). Not needed with an adjustable aftermarket cable.' },
  trans_fluid: { i: [0, 12], src: 'Ford', what: 'Level at the fill plug, leaks at seals', note: 'Ford doesn\'t schedule a manual transmission fluid change, only a yearly check. Many owners refresh the T-5\'s MERCON ATF every 60,000 mi.' },
  transmission: { i: [30000, 24], what: 'Shift feel, noises, leaks' },
  trans_mount: { i: [30000, 24], l: [100000, 120], what: 'Cracked or collapsed rubber' },
  driveshaft: { i: [15000, 12], what: 'U-joint play' },
  rear_diff_fluid: { rs: [60000, 0], i: [15000, 12], src: 'Ford', what: 'Leaks at the pinion and cover', note: 'Ford Normal: don\'t change unless leaking, repaired or the axle was submerged. Severe (towing): 60,000 mi. Traction-Lok needs 4 oz friction modifier.' },
  rear_diff: { i: [30000, 24], what: 'Whine on throttle or coast, pinion seal leaks' },
  axle_seals: { i: [15000, 12], what: 'Gear oil on the inside of the rear wheels' },
  rear_cv: { i: [15000, 12], what: 'Boots not torn, no clicking' },
  front_cv: { i: [15000, 12], what: 'Boots not torn, no clicking on turns' },
  transfer_fluid: { r: [60000, 60], rs: [30000, 36], i: [15000, 12], what: 'Level and leaks' },
  front_diff_fluid: { r: [60000, 60], rs: [30000, 36], i: [15000, 12], what: 'Level and leaks' },
  front_driveshaft: { i: [15000, 12], what: 'U-joint play' },
  // ---- Brakes (Ford inspects every 30,000 mi; checking at every rotation is common practice) ----
  brake_fluid: { r: [0, 36], i: [0, 12], what: 'Level and color; moisture test', note: 'Ford schedules a yearly level check only. Flushing DOT 3 every 2–3 years is common practice.' },
  brake_master: { i: [15000, 12], what: 'Pedal firm, no fluid loss, booster holds vacuum' },
  pads: { i: [15000, 12], is: [7500, 6], what: 'Pad thickness (measure), even wear' },
  rotors: { i: [15000, 12], is: [7500, 6], what: 'Thickness, scoring, pulsation' },
  caliper: { i: [15000, 12], is: [7500, 6], what: 'Slides free, boots intact, no leaks' },
  shoes_R: { i: [15000, 12], is: [7500, 6], what: 'Lining thickness' },
  drums_R: { i: [15000, 12], is: [7500, 6], what: 'Wheel cylinder leaks, drum wear' },
  parking_brake: { i: [15000, 12], what: 'Holds on a hill; cables move freely' },
  brake_lines: { i: [15000, 12], l: [0, 120], what: 'Rust on steel lines, cracked rubber hoses' },
  // ---- Tires & wheels ----
  rotation: { r: [7500, 12], note: 'Ford\'s SN95 guide lists every 10,000 mi (9,000 severe). Tire makers usually say 5,000–7,500 mi.' },
  alignment: { i: [15000, 24], what: 'Pulling, uneven tire wear; after hitting a curb or new parts' },
  tire: { i: [5000, 6], src: 'Ford', what: 'Tread depth (measure), pressure monthly, sidewall cracks' },
  bearing: { i: [30000, 24], what: 'Play and noise' },
  // ---- Suspension & steering (not in Ford's schedule; general inspection guidance) ----
  strut: { i: [15000, 12], l: [75000, 96], what: 'Leaks, bounce test, worn mounts' },
  strut_mount: { i: [30000, 24], l: [100000, 120], what: 'Clunk over bumps, binding when steering' },
  shock: { i: [15000, 12], l: [75000, 96], what: 'Leaks, bounce test' },
  spring: { i: [30000, 24], what: 'Cracks, sag, ride height' },
  lca: { i: [30000, 24], l: [120000, 144], what: 'Bushings torn or cracked' },
  uca: { i: [30000, 24], l: [120000, 144], what: 'Bushings torn or cracked' },
  rear_lca: { i: [30000, 24], l: [120000, 144], what: 'Bushings, clunk on launch' },
  rear_uca: { i: [30000, 24], l: [120000, 144], what: 'Bushings, axle wrap' },
  rear_arms: { i: [30000, 24], l: [120000, 144], what: 'Bushings' },
  balljoint: { i: [15000, 12], l: [120000, 0], what: 'Play with the wheel off the ground; boots intact' },
  sway: { i: [30000, 24], what: 'End links and bushings' },
  steering_rack: { i: [15000, 12], what: 'Boots, leaks, play at the wheel' },
  ps_fluid: { i: [0, 6], src: 'Ford', what: 'Level and color', note: 'Ford schedules a check twice a year, no change interval.' },
  ps_pump: { i: [15000, 12], what: 'Whine, leaks' },
  tierod: { i: [15000, 12], l: [120000, 0], what: 'Play at inner and outer ends, boots' },
  // ---- Exhaust & emissions ----
  o2_up: { l: [100000, 0], note: 'No factory interval. Older sensors slow down; the OBD diagnosis flags lazy sensors.' },
  o2_down: { l: [150000, 0] },
  cat: { i: [30000, 24], what: 'Rattle, rotten-egg smell, P0420 / P0430' },
  exhaust: { i: [0, 6], src: 'Ford', what: 'Pipes, shields, hangers and clamps (Ford: inspect heat shields every 30,000 mi)' },
  muffler: { i: [0, 6], src: 'Ford', what: 'Rust-through, rattles' },
  egr: { i: [30000, 24], what: 'Vacuum hoses and DPFE sensor hoses' },
  evap: { i: [15000, 12], what: 'Gas cap seal, hoses at the canister' },
  // ---- Body & lights (Ford owner checks) ----
  wipers: { r: [0, 12], i: [0, 6], src: 'Ford', what: 'Streaking, torn rubber' },
  headlights: { i: [0, 1], src: 'Ford', what: 'All bulbs work (monthly); aim twice a year' },
  taillights: { i: [0, 1], src: 'Ford', what: 'Brake, turn and tail lights (monthly)' },
  washer: { i: [0, 6], src: 'Ford', what: 'Washer spray, horn' },
  interior: { i: [0, 12], what: 'Gauges, switches, HVAC, blower speeds' },
  restraints: { i: [0, 6], src: 'Ford', what: 'Belts retract and latch, airbag light off' },
  body: { i: [0, 6], src: 'Ford', what: 'Lube hinges and latches, check weatherstrips and body drain holes' },
  chassis: { i: [0, 12], what: 'Rust on rails, floor pans and torque boxes' },
};

// Part key → schedule key: exact, or with position suffix removed.
function pmKey(key) {
  if (PM[key]) return key;
  const k = key.replace(/_(FL|FR|RL|RR|F|R|L|1|2|SP)$/, '');
  if (PM[k]) return k;
  if (key.startsWith('tire_')) return 'tire';
  if (key.startsWith('engine_mount')) return 'engine_mount';
  return null;
}

const pair = (a) => (a ? { im: a[0] || 0, mo: a[1] || 0 } : null);

// Schedule entry for a part in a mode: { replace, inspect, what, note, src }.
export function scheduleFor(vehicle, part, mode = vehicle?.scheduleMode || 'normal') {
  const k = pmKey(part.key);
  const cat = VEHICLE_CATALOGS[vehicle?.presetId]?.schedule?.[k] || {};
  const e = k ? { ...PM[k], ...cat } : null;
  if (!e) return null;
  const sev = mode === 'severe';
  return {
    key: k,
    replace: pair(sev ? e.rs || e.r : e.r),
    inspect: pair(sev && e.is ? e.is : e.i),
    life: pair(e.l),
    what: e.what, note: e.note, src: e.src || 'General',
  };
}

// Apply the schedule to a part for this vehicle (in memory). User-set
// intervals (customInterval) are kept; parts not in the schedule keep theirs.
export function withSchedule(vehicle, part) {
  const s = scheduleFor(vehicle, part);
  if (!s) return part;
  const out = { ...part, pm: s };
  if (!part.customInterval && s.replace) { out.im = s.replace.im; out.mo = s.replace.mo; }
  if (!part.customInterval && !s.replace) { out.im = 0; out.mo = 0; }
  out.inspect = part.customInspect || s.inspect || null;
  out.life = s.life || null;
  return out;
}
