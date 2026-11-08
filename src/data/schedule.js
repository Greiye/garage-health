// Preventive maintenance schedule.
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
// r: replace [mi, mo], rs: severe replace, i: inspect [mi, mo], is: severe inspect, what: what to check
export const PM = {
  // Engine
  engine: { i: [5000, 6], is: [3000, 3], what: 'Leaks, noises, oil consumption between changes' },
  intake_gasket: { i: [5000, 6], is: [3000, 3], what: `${LEAK_CHECK} at the intake; watch coolant level and fuel trims` },
  valve_cover_gaskets: { i: [5000, 6], is: [3000, 3], what: `${LEAK_CHECK} along the valve covers and on the plug wells` },
  head_gaskets: { i: [15000, 12], what: 'Coolant loss, white exhaust, oil condition (milky)' },
  oil_pan_gasket: { i: [5000, 6], is: [3000, 3], what: `${LEAK_CHECK} at the pan rail and drain plug` },
  front_cover: { i: [5000, 6], is: [3000, 3], what: `${LEAK_CHECK} at the timing cover and crank seal` },
  rear_main_seal: { i: [5000, 6], is: [3000, 3], what: 'Oil drips at the bellhousing seam' },
  timing: { i: [60000, 0], what: 'Chain slap or rattle at cold start' },
  pcv: { r: [60000, 60], i: [30000, 24], what: 'Valve rattles when shaken; hoses not cracked or soft' },
  engine_mount: { i: [30000, 24], what: 'Cracked or collapsed rubber, engine lift under throttle' },
  cam_sensor: { i: [60000, 0], what: 'Connector and wiring' },
  crank_sensor: { i: [60000, 0], what: 'Connector and wiring' },
  // Lubrication (Ford: 5W-20, 5,000 mi / 6 mo normal; 3,000 mi / 3 mo severe)
  oil: { r: [5000, 6], rs: [3000, 3], src: 'Ford', note: 'Check the dipstick every few fill-ups; the 3.8 can use some oil at high miles.' },
  // Cooling
  coolant: { r: [36000, 36], i: [5000, 6], is: [3000, 3], what: 'Level in the reservoir (cold) and color; test freeze point yearly', note: 'Green conventional coolant: 3 yr / 36k mi. Gold (Premium Gold): 5 yr / 100k mi first change, then 3 yr / 50k. Edit the interval if you run Gold.' },
  radiator: { i: [15000, 12], what: 'Fins clear, no leaks at tanks or seams' },
  hoses: { r: [60000, 60], i: [15000, 12], what: 'Squeeze when cold: replace if soft, swollen, cracked or crunchy' },
  thermostat: { r: [100000, 120], i: [15000, 12], what: 'Warms up in 10 min, holds about 195°F' },
  water_pump: { r: [100000, 120], i: [15000, 12], what: 'Weep hole dry, no shaft play or bearing noise' },
  fan: { i: [15000, 12], what: 'Comes on at temperature and with A/C' },
  rad_cap: { r: [0, 60], i: [30000, 24], what: 'Seal not cracked; pressure test' },
  heater_core: { i: [0, 12], what: 'Heat output, sweet smell or fogging inside' },
  ac_system: { i: [0, 12], what: 'Vent temperature, compressor engages, no oily spots' },
  belt: { r: [60000, 60], i: [15000, 12], what: 'Cracks, glazing, chunks missing, squeal' },
  tensioner: { r: [100000, 0], i: [30000, 24], what: 'Arm steady at idle, pulley bearing quiet' },
  // Ignition (Ford: platinum plugs 100k)
  plugs: { r: [100000, 0], src: 'Ford' },
  plug_wires: { r: [100000, 120], i: [30000, 24], what: 'Cracks, burns, arcing in the dark' },
  coils: { i: [30000, 24], what: 'Cracks or carbon tracking on the coil pack' },
  // Fuel / air (Ford: fuel filter 30k, air filter 30k normal)
  fuel_filter: { r: [30000, 0], src: 'Ford' },
  fuel_pump: { i: [30000, 0], what: 'Fuel pressure, whine from the tank' },
  injectors: { i: [30000, 0], what: 'Fuel trims, misfire counts' },
  fuel_tank: { i: [0, 12], what: 'Straps, filler neck, fuel smell' },
  air_filter: { r: [30000, 36], rs: [15000, 18], i: [15000, 12], is: [5000, 6], what: 'Hold to light; replace if dark or clogged', src: 'Ford' },
  maf: { r: [30000, 36], what: 'Clean the sensing wire with MAF cleaner' },
  throttle_body: { r: [30000, 36], what: 'Clean the bore and idle air control valve' },
  cabin_filter: { r: [15000, 12], rs: [10000, 12] },
  // Electrical
  battery: { i: [0, 12], what: 'Load test, terminals clean and tight', note: 'Most batteries last 4–6 years.' },
  alternator: { i: [0, 12], what: 'Charging 13.5–14.7 V, no whine' },
  starter: { i: [0, 12], what: 'Cranks strong, no grinding' },
  // Drivetrain
  clutch: { i: [15000, 12], what: 'Engagement point, slip in high gear under load' },
  clutch_cable: { i: [15000, 12], what: 'Fluid level and color, or cable/quadrant wear' },
  trans_fluid: { r: [60000, 60], rs: [30000, 36], i: [30000, 24], what: 'Fill-plug level, leaks at seals' },
  transmission: { i: [30000, 24], what: 'Shift feel, noises, leaks' },
  trans_mount: { i: [30000, 24], what: 'Cracked or collapsed rubber' },
  driveshaft: { i: [15000, 12], is: [7500, 6], what: 'U-joint play and grease where fittings exist' },
  rear_diff_fluid: { r: [100000, 0], rs: [30000, 36], i: [15000, 12], what: 'Level at the fill plug; change if the axle was submerged', note: 'Limited-slip (Traction-Lok) needs friction modifier when the lube is changed.' },
  rear_diff: { i: [30000, 24], what: 'Whine on throttle or coast, pinion seal leaks' },
  axle_seals: { i: [15000, 12], what: 'Gear oil on the inside of the rear wheels' },
  rear_cv: { i: [15000, 12], what: 'Boots not torn, no clicking' },
  front_cv: { i: [15000, 12], what: 'Boots not torn, no clicking on turns' },
  transfer_fluid: { r: [60000, 60], rs: [30000, 36], i: [15000, 12], what: 'Level and leaks' },
  front_diff_fluid: { r: [60000, 60], rs: [30000, 36], i: [15000, 12], what: 'Level and leaks' },
  front_driveshaft: { i: [15000, 12], what: 'U-joint play' },
  // Brakes
  brake_fluid: { r: [0, 36], i: [15000, 12], what: 'Level and color; moisture test', note: 'General guidance: flush every 2–3 years.' },
  brake_master: { i: [15000, 12], what: 'Pedal firm, no fluid loss, booster holds vacuum' },
  pads: { i: [15000, 12], is: [5000, 6], what: 'Pad thickness (measure), even wear' },
  rotors: { i: [15000, 12], is: [5000, 6], what: 'Thickness, scoring, pulsation' },
  caliper: { i: [15000, 12], is: [5000, 6], what: 'Slides free, boots intact, no leaks' },
  shoes_R: { i: [15000, 12], is: [5000, 6], what: 'Lining thickness' },
  drums_R: { i: [15000, 12], is: [5000, 6], what: 'Wheel cylinder leaks, drum wear' },
  parking_brake: { i: [15000, 12], what: 'Holds on a hill; cables move freely' },
  brake_lines: { i: [15000, 12], what: 'Rust on steel lines, cracked rubber hoses' },
  // Tires & wheels (Ford: rotate every 5,000 mi)
  rotation: { r: [5000, 6], src: 'Ford' },
  alignment: { i: [15000, 24], what: 'Pulling, uneven tire wear; after hitting a curb or new parts' },
  tire: { i: [5000, 6], what: 'Tread depth (measure), pressure, sidewall cracks' },
  bearing: { i: [30000, 24], what: 'Play and noise' },
  // Suspension & steering
  strut: { i: [15000, 12], what: 'Leaks, bounce test, worn mounts' },
  strut_mount: { i: [30000, 24], what: 'Clunk over bumps, binding when steering' },
  shock: { i: [15000, 12], what: 'Leaks, bounce test' },
  spring: { i: [30000, 24], what: 'Cracks, sag, ride height' },
  lca: { i: [30000, 24], what: 'Bushings torn or cracked' },
  uca: { i: [30000, 24], what: 'Bushings torn or cracked' },
  rear_lca: { i: [30000, 24], what: 'Bushings, clunk on launch' },
  rear_uca: { i: [30000, 24], what: 'Bushings, axle wrap' },
  rear_arms: { i: [30000, 24], what: 'Bushings' },
  balljoint: { i: [15000, 12], what: 'Play with the wheel off the ground; boots intact' },
  sway: { i: [30000, 24], what: 'End links and bushings' },
  steering_rack: { i: [15000, 12], what: 'Boots, leaks, play at the wheel' },
  ps_fluid: { r: [60000, 60], i: [5000, 6], what: 'Level and color' },
  ps_pump: { i: [15000, 12], what: 'Whine, leaks' },
  tierod: { i: [15000, 12], what: 'Play at inner and outer ends, boots' },
  // Exhaust & emissions
  o2_up: { r: [100000, 0] },
  o2_down: { r: [100000, 0] },
  cat: { i: [30000, 24], what: 'Rattle, rotten-egg smell, P0420/P0430' },
  exhaust: { i: [15000, 12], what: 'Leaks (ticking), rusted hangers, heat shields' },
  muffler: { i: [15000, 12], what: 'Rust-through, rattles' },
  egr: { i: [30000, 24], what: 'Vacuum hoses and DPFE sensor hoses' },
  evap: { i: [15000, 12], what: 'Gas cap seal, hoses at the canister' },
  // Body & lights
  wipers: { r: [0, 12] },
  headlights: { i: [0, 6], what: 'All bulbs work, lenses clear' },
  taillights: { i: [0, 6], what: 'Brake, turn and tail lights' },
  washer: { i: [0, 6], what: 'Washer spray, horn' },
  interior: { i: [0, 12], what: 'Gauges, switches, HVAC, blower speeds' },
  restraints: { i: [0, 12], what: 'Belts retract and latch, airbag light off' },
  body: { i: [0, 12], what: 'Door hinges and latches lubed, seals, glass' },
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
    replace: pair(sev && e.rs ? e.rs : e.r),
    inspect: pair(sev && e.is ? e.is : e.i),
    what: e.what, note: e.note, src: e.src,
  };
}

// Apply the schedule to a part for this vehicle (in memory). User-set
// intervals (customInterval) are kept; parts not in the schedule keep theirs.
export function withSchedule(vehicle, part) {
  const s = scheduleFor(vehicle, part);
  if (!s) return part;
  const out = { ...part, pm: s };
  if (!part.customInterval && s.replace) { out.im = s.replace.im; out.mo = s.replace.mo; }
  if (!part.customInterval && !s.replace && s.inspect) { out.im = 0; out.mo = 0; }
  out.inspect = part.customInspect || s.inspect || null;
  return out;
}
