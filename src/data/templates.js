// Vehicle-agnostic part catalog. A vehicle is described by a handful of
// options (drivetrain, transmission, suspension, body type...) and the part
// list is generated from them. Every value here is a default the user can edit.
//
// Part def fields:
//   key        unique within vehicle
//   name       display name
//   system     grouping for lists
//   slot       3D model slot the part lights up
//   position   FL/FR/RL/RR/F/R/L/R (optional)
//   im, mo     interval in miles / months (0 = none)
//   age        max component age in months from manufacture date (e.g. tires)
//   measure    { label, unit, nominal, limit } — health scales linearly from
//              nominal (0%) to limit (100%). Works for lower- or higher-is-worse.
//   kind       'tire' enables DOT date, rotation, tread history
//   note       hint shown in the part panel

export const SYSTEMS = [
  'Engine', 'Lubrication', 'Cooling', 'Ignition', 'Fuel', 'Air intake',
  'Electrical', 'Drivetrain', 'Brakes', 'Tires & wheels', 'Suspension',
  'Steering', 'Exhaust & emissions', 'Body & lights',
];

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const SIDE = { FL: 'L', RL: 'L', FR: 'R', RR: 'R' };
const CORNER_NAME = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function buildPartList(o) {
  const P = [];
  const add = (p) => P.push(p);
  const v = o.layout === 'V';
  const banks = v ? ['bank 1', 'bank 2'] : ['bank 1'];
  const rwdLike = o.drivetrain === 'rwd' || o.drivetrain === '4wd';
  const fwdLike = o.drivetrain === 'fwd' || o.drivetrain === 'awd';

  // ---------- Engine ----------
  add({ key: 'engine', name: 'Engine (long block)', system: 'Engine', slot: 'engine', im: 0, mo: 0,
    measure: { label: 'Lowest compression', unit: 'psi', nominal: 170, limit: 120 },
    note: 'Log compression or leak-down results as measurements. Spread over 10% between cylinders is worth a symptom flag.' });
  add({ key: 'intake_gasket', name: 'Intake manifold gaskets', system: 'Engine', slot: 'intake', im: 0, mo: 0 });
  add({ key: 'valve_cover_gaskets', name: 'Valve cover gaskets', system: 'Engine', slot: 'engine', im: 0, mo: 0 });
  add({ key: 'head_gaskets', name: 'Head gaskets', system: 'Engine', slot: 'engine', im: 0, mo: 0 });
  add({ key: 'timing', name: o.timing === 'belt' ? 'Timing belt' : 'Timing chain & guides', system: 'Engine', slot: 'engine',
    im: o.timing === 'belt' ? 90000 : 0, mo: o.timing === 'belt' ? 84 : 0 });
  add({ key: 'pcv', name: 'PCV valve', system: 'Engine', slot: 'intake', im: 60000, mo: 60 });
  add({ key: 'engine_mount_L', name: 'Engine mount left', system: 'Engine', slot: 'mounts', position: 'L', im: 0, mo: 0 });
  add({ key: 'engine_mount_R', name: 'Engine mount right', system: 'Engine', slot: 'mounts', position: 'R', im: 0, mo: 0 });
  add({ key: 'cam_sensor', name: 'Camshaft position sensor', system: 'Engine', slot: 'engine', im: 0, mo: 0 });
  add({ key: 'crank_sensor', name: 'Crankshaft position sensor', system: 'Engine', slot: 'engine', im: 0, mo: 0 });

  // ---------- Lubrication ----------
  add({ key: 'oil', name: 'Engine oil & filter', system: 'Lubrication', slot: 'oil', im: 5000, mo: 6 });
  add({ key: 'oil_pan_gasket', name: 'Oil pan gasket', system: 'Lubrication', slot: 'oil', im: 0, mo: 0 });

  // ---------- Cooling ----------
  add({ key: 'coolant', name: 'Coolant', system: 'Cooling', slot: 'radiator', im: 50000, mo: 60 });
  add({ key: 'radiator', name: 'Radiator', system: 'Cooling', slot: 'radiator', im: 0, mo: 0 });
  add({ key: 'hoses', name: 'Radiator & heater hoses', system: 'Cooling', slot: 'hoses', im: 60000, mo: 60 });
  add({ key: 'thermostat', name: 'Thermostat', system: 'Cooling', slot: 'thermostat', im: 100000, mo: 120 });
  add({ key: 'water_pump', name: 'Water pump', system: 'Cooling', slot: 'waterPump', im: 100000, mo: 120 });
  add({ key: 'fan', name: 'Cooling fan', system: 'Cooling', slot: 'radiator', im: 0, mo: 0 });

  // ---------- Accessory drive ----------
  add({ key: 'belt', name: 'Serpentine belt', system: 'Engine', slot: 'belt', im: 60000, mo: 60 });
  add({ key: 'tensioner', name: 'Belt tensioner & idler', system: 'Engine', slot: 'belt', im: 100000, mo: 0 });

  // ---------- Ignition ----------
  add({ key: 'plugs', name: `Spark plugs (${o.cylinders})`, system: 'Ignition', slot: 'plugs', im: o.plugMiles ?? 100000, mo: 0 });
  if (o.plugWires) add({ key: 'plug_wires', name: 'Spark plug wires', system: 'Ignition', slot: 'plugs', im: 100000, mo: 120 });
  add({ key: 'coils', name: o.plugWires ? 'Ignition coil pack' : 'Ignition coils', system: 'Ignition', slot: 'coils', im: 0, mo: 0 });

  // ---------- Fuel ----------
  add({ key: 'fuel_filter', name: 'Fuel filter', system: 'Fuel', slot: 'fuelFilter', im: o.fuelFilterMiles ?? 30000, mo: 0 });
  add({ key: 'fuel_pump', name: 'Fuel pump', system: 'Fuel', slot: 'fuelPump', im: 0, mo: 0 });
  add({ key: 'injectors', name: 'Fuel injectors', system: 'Fuel', slot: 'fuelRail', im: 0, mo: 0 });
  add({ key: 'fuel_tank', name: 'Fuel tank & sender', system: 'Fuel', slot: 'fuelTank', im: 0, mo: 0 });

  // ---------- Air intake ----------
  add({ key: 'air_filter', name: 'Engine air filter', system: 'Air intake', slot: 'airbox', im: 15000, mo: 24 });
  add({ key: 'maf', name: 'MAF sensor (clean)', system: 'Air intake', slot: 'airbox', im: 30000, mo: 36 });
  add({ key: 'throttle_body', name: 'Throttle body & IAC (clean)', system: 'Air intake', slot: 'throttle', im: 30000, mo: 36 });
  if (o.cabinFilter) add({ key: 'cabin_filter', name: 'Cabin air filter', system: 'Air intake', slot: 'cabin', im: 15000, mo: 12 });

  // ---------- Electrical ----------
  add({ key: 'battery', name: 'Battery', system: 'Electrical', slot: 'battery', im: 0, mo: 0, age: 60,
    measure: { label: 'Resting voltage', unit: 'V', nominal: 12.7, limit: 12.2 },
    note: 'Measure after the car sits a few hours. Enter the manufacture date from the case sticker.' });
  add({ key: 'alternator', name: 'Alternator', system: 'Electrical', slot: 'alternator', im: 0, mo: 0,
    measure: { label: 'Charging voltage', unit: 'V', nominal: 14.2, limit: 13.2 } });
  add({ key: 'starter', name: 'Starter', system: 'Electrical', slot: 'starter', im: 0, mo: 0 });

  // ---------- Drivetrain ----------
  if (o.trans === 'manual') {
    add({ key: 'clutch', name: 'Clutch disc, pressure plate & throwout bearing', system: 'Drivetrain', slot: 'clutch', im: 0, mo: 0 });
    add({ key: 'clutch_cable', name: o.clutchHydraulic ? 'Clutch hydraulics' : 'Clutch cable & quadrant', system: 'Drivetrain', slot: 'clutch', im: 0, mo: 0 });
    add({ key: 'trans_fluid', name: 'Manual transmission fluid', system: 'Drivetrain', slot: 'transmission', im: 60000, mo: 60 });
  } else {
    add({ key: 'trans_fluid', name: 'Automatic transmission fluid & filter', system: 'Drivetrain', slot: 'transmission', im: 30000, mo: 36 });
  }
  add({ key: 'transmission', name: fwdLike ? 'Transaxle' : 'Transmission', system: 'Drivetrain', slot: 'transmission', im: 0, mo: 0 });
  if (rwdLike || o.drivetrain === 'awd') add({ key: 'trans_mount', name: 'Transmission mount', system: 'Drivetrain', slot: 'mounts', im: 0, mo: 0 });
  if (rwdLike || o.drivetrain === 'awd') {
    add({ key: 'driveshaft', name: 'Driveshaft & U-joints', system: 'Drivetrain', slot: 'driveshaft', im: 30000, mo: 24, note: 'Interval is an inspection. Grease U-joints if they have zerks.' });
    add({ key: 'rear_diff_fluid', name: 'Rear differential fluid', system: 'Drivetrain', slot: 'differential', im: 60000, mo: 60 });
    add({ key: 'rear_diff', name: 'Rear differential', system: 'Drivetrain', slot: 'differential', im: 0, mo: 0 });
    if (o.rearSuspension === 'solid') {
      add({ key: 'axle_seals', name: 'Axle shafts, bearings & seals', system: 'Drivetrain', slot: 'rearAxle', im: 0, mo: 0 });
    } else {
      for (const s of ['L', 'R']) add({ key: `rear_cv_${s}`, name: `Rear CV axle ${s === 'L' ? 'left' : 'right'}`, system: 'Drivetrain', slot: `rearCv_${s}`, position: s, im: 0, mo: 0 });
    }
  }
  if (fwdLike || o.drivetrain === '4wd') {
    for (const s of ['L', 'R']) add({ key: `front_cv_${s}`, name: `Front CV axle ${s === 'L' ? 'left' : 'right'}`, system: 'Drivetrain', slot: `frontCv_${s}`, position: s, im: 0, mo: 0 });
  }
  if (o.drivetrain === '4wd' || o.drivetrain === 'awd') {
    add({ key: 'transfer_fluid', name: o.drivetrain === '4wd' ? 'Transfer case fluid' : 'Power transfer unit fluid', system: 'Drivetrain', slot: 'transferCase', im: 60000, mo: 60 });
  }
  if (o.drivetrain === '4wd') {
    add({ key: 'front_diff_fluid', name: 'Front differential fluid', system: 'Drivetrain', slot: 'frontDiff', im: 60000, mo: 60 });
    add({ key: 'front_driveshaft', name: 'Front driveshaft & U-joints', system: 'Drivetrain', slot: 'frontDriveshaft', im: 30000, mo: 24 });
  }

  // ---------- Brakes ----------
  add({ key: 'brake_fluid', name: 'Brake fluid', system: 'Brakes', slot: 'brakeMaster', im: 0, mo: 24 });
  add({ key: 'brake_master', name: 'Master cylinder & booster', system: 'Brakes', slot: 'brakeMaster', im: 0, mo: 0 });
  for (const ax of ['F', 'R']) {
    const axn = ax === 'F' ? 'Front' : 'Rear';
    const c = ax === 'F' ? ['FL', 'FR'] : ['RL', 'RR'];
    if (ax === 'R' && o.rearBrakes === 'drum') {
      add({ key: 'shoes_R', name: 'Rear brake shoes', system: 'Brakes', slot: 'brake_RL', position: 'R', im: 0, mo: 0,
        measure: { label: 'Lining thickness', unit: 'mm', nominal: 5, limit: 1.5 }, also: ['brake_RR'] });
      add({ key: 'drums_R', name: 'Rear drums & wheel cylinders', system: 'Brakes', slot: 'brake_RR', position: 'R', im: 0, mo: 0, also: ['brake_RL'] });
      continue;
    }
    add({ key: `pads_${ax}`, name: `${axn} brake pads`, system: 'Brakes', slot: `brake_${c[0]}`, also: [`brake_${c[1]}`], position: ax, im: 0, mo: 0,
      measure: { label: 'Thinnest pad', unit: 'mm', nominal: ax === 'F' ? 11 : 9, limit: 3 } });
    add({ key: `rotors_${ax}`, name: `${axn} rotors`, system: 'Brakes', slot: `brake_${c[0]}`, also: [`brake_${c[1]}`], position: ax, im: 0, mo: 0,
      measure: { label: 'Rotor thickness', unit: 'mm', nominal: null, limit: null },
      note: 'Set nominal and minimum thickness from the number cast into the rotor.' });
    for (const k of c) add({ key: `caliper_${k}`, name: `Caliper ${CORNER_NAME[k]}`, system: 'Brakes', slot: `brake_${k}`, position: k, im: 0, mo: 0 });
  }
  add({ key: 'brake_lines', name: 'Brake lines & hoses', system: 'Brakes', slot: 'brakeMaster', im: 0, mo: 0 });

  // ---------- Tires & wheels ----------
  add({ key: 'rotation', name: 'Tire rotation', system: 'Tires & wheels', slot: 'tires', im: 5000, mo: 6,
    note: 'Rotation applies to all four tires; due rotations blink every tire.' });
  add({ key: 'alignment', name: 'Wheel alignment', system: 'Tires & wheels', slot: 'tires', im: 0, mo: 24 });
  for (const k of CORNERS) {
    add({ key: `tire_${k}`, name: `Tire ${CORNER_NAME[k]}`, system: 'Tires & wheels', slot: `tire_${k}`, position: k, kind: 'tire',
      im: 0, mo: 0, age: 72, measure: { label: 'Tread depth', unit: '/32"', nominal: 10, limit: 2 } });
    add({ key: `bearing_${k}`, name: `Wheel bearing/hub ${CORNER_NAME[k]}`, system: 'Tires & wheels', slot: `hub_${k}`, position: k, im: 0, mo: 0 });
  }
  if (o.spare) add({ key: 'tire_SP', name: 'Spare tire', system: 'Tires & wheels', slot: 'spare', position: 'SP', kind: 'tire', im: 0, mo: 0, age: 120,
    measure: { label: 'Tread depth', unit: '/32"', nominal: 10, limit: 2 } });

  // ---------- Suspension ----------
  for (const k of ['FL', 'FR']) {
    const n = CORNER_NAME[k];
    if (o.frontSuspension === 'strut') {
      add({ key: `strut_${k}`, name: `Strut ${n}`, system: 'Suspension', slot: `damper_${k}`, position: k, im: 0, mo: 0 });
      add({ key: `strut_mount_${k}`, name: `Strut mount ${n}`, system: 'Suspension', slot: `damper_${k}`, position: k, im: 0, mo: 0 });
    } else {
      add({ key: `shock_${k}`, name: `Shock ${n}`, system: 'Suspension', slot: `damper_${k}`, position: k, im: 0, mo: 0 });
    }
    add({ key: `spring_${k}`, name: `${o.frontSuspension === 'strut' || o.frontSuspension === 'wishbone' ? 'Coil spring' : 'Spring'} ${n}`, system: 'Suspension', slot: `spring_${k}`, position: k, im: 0, mo: 0 });
    add({ key: `lca_${k}`, name: `Lower control arm & bushings ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 0, mo: 0 });
    add({ key: `balljoint_${k}`, name: `Lower ball joint ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 30000, mo: 24, note: 'Interval is an inspection.' });
    if (o.frontSuspension === 'wishbone') add({ key: `uca_${k}`, name: `Upper control arm ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 0, mo: 0 });
  }
  for (const k of ['RL', 'RR']) {
    const n = CORNER_NAME[k];
    add({ key: `shock_${k}`, name: `Shock ${n}`, system: 'Suspension', slot: `damper_${k}`, position: k, im: 0, mo: 0 });
    add({ key: `spring_${k}`, name: `${o.rearSuspension === 'leaf' ? 'Leaf spring' : 'Coil spring'} ${n}`, system: 'Suspension', slot: `spring_${k}`, position: k, im: 0, mo: 0 });
    if (o.rearSuspension === 'solid') {
      add({ key: `rear_lca_${k}`, name: `Lower control arm & bushings ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 0, mo: 0 });
      add({ key: `rear_uca_${k}`, name: `Upper control arm & bushings ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 0, mo: 0 });
    } else if (o.rearSuspension === 'independent') {
      add({ key: `rear_arms_${k}`, name: `Rear control arms & bushings ${n}`, system: 'Suspension', slot: `arm_${k}`, position: k, im: 0, mo: 0 });
    }
  }
  for (const ax of ['F', 'R']) {
    add({ key: `sway_${ax}`, name: `${ax === 'F' ? 'Front' : 'Rear'} sway bar, links & bushings`, system: 'Suspension', slot: `sway_${ax}`, position: ax, im: 0, mo: 0 });
  }

  // ---------- Steering ----------
  add({ key: 'steering_rack', name: o.steering === 'box' ? 'Steering gearbox' : 'Steering rack & boots', system: 'Steering', slot: 'steering', im: 0, mo: 0 });
  add({ key: 'ps_fluid', name: 'Power steering fluid', system: 'Steering', slot: 'psReservoir', im: 60000, mo: 60 });
  add({ key: 'ps_pump', name: 'Power steering pump', system: 'Steering', slot: 'psReservoir', im: 0, mo: 0 });
  for (const s of ['L', 'R']) {
    add({ key: `tierod_${s}`, name: `Tie rod ends ${s === 'L' ? 'left' : 'right'}`, system: 'Steering', slot: `tierod_${s}`, position: s, im: 30000, mo: 24, note: 'Interval is an inspection.' });
  }

  // ---------- Exhaust & emissions ----------
  for (const b of banks) {
    const n = banks.length > 1 ? ` ${b}` : '';
    const s = b === 'bank 2' ? '2' : '1';
    add({ key: `o2_up_${s}`, name: `Upstream O2 sensor${n}`, system: 'Exhaust & emissions', slot: `o2_${s}`, im: 100000, mo: 0 });
    add({ key: `o2_down_${s}`, name: `Downstream O2 sensor${n}`, system: 'Exhaust & emissions', slot: `o2_${s}`, im: 100000, mo: 0 });
    add({ key: `cat_${s}`, name: `Catalytic converter${n}`, system: 'Exhaust & emissions', slot: `cat_${s}`, im: 0, mo: 0 });
  }
  add({ key: 'exhaust', name: 'Exhaust pipes, hangers & gaskets', system: 'Exhaust & emissions', slot: 'exhaust', im: 0, mo: 0 });
  add({ key: 'muffler', name: o.dualExhaust ? 'Mufflers' : 'Muffler', system: 'Exhaust & emissions', slot: 'muffler', im: 0, mo: 0 });
  if (o.egr) add({ key: 'egr', name: 'EGR valve & DPFE sensor', system: 'Exhaust & emissions', slot: 'intake', im: 0, mo: 0 });
  add({ key: 'evap', name: 'EVAP system & gas cap', system: 'Exhaust & emissions', slot: 'fuelTank', im: 0, mo: 0 });

  // ---------- Body & lights ----------
  add({ key: 'wipers', name: 'Wiper blades', system: 'Body & lights', slot: 'wipers', im: 0, mo: 12 });
  add({ key: 'headlights', name: 'Headlight bulbs & lenses', system: 'Body & lights', slot: 'headlights', im: 0, mo: 0 });
  add({ key: 'taillights', name: 'Tail, brake & turn lights', system: 'Body & lights', slot: 'taillights', im: 0, mo: 0 });

  return P.map((p) => ({ im: 0, mo: 0, ...p }));
}

// ---------- Presets ----------
export const BASE_OPTIONS = {
  bodyType: 'coupe', drivetrain: 'rwd', trans: 'manual', cylinders: 6, layout: 'V', engineMount: 'longitudinal',
  timing: 'chain', plugWires: true, frontSuspension: 'strut', rearSuspension: 'solid', rearBrakes: 'disc',
  steering: 'rack', cabinFilter: true, spare: true, egr: true, dualExhaust: false, clutchHydraulic: true,
};

export const PRESETS = [
  {
    id: 'mustang-2001-v6-manual',
    label: '2001 Ford Mustang 3.8 V6, T-5 manual',
    vehicle: { year: 2001, make: 'Ford', model: 'Mustang', trim: 'V6', engine: '3.8L V6 (Essex)', transmission: 'T-5 5-speed manual', bodyColor: '#b0181f' },
    options: {
      ...BASE_OPTIONS, bodyType: 'coupe', drivetrain: 'rwd', trans: 'manual', cylinders: 6, layout: 'V', engineMount: 'longitudinal',
      timing: 'chain', plugWires: true, frontSuspension: 'strut', rearSuspension: 'solid', rearBrakes: 'drum', cabinFilter: false,
      spare: true, egr: true, dualExhaust: true, clutchHydraulic: false,
    },
    // Known weak spots for this platform: seeded as notes, not flags.
    partNotes: {
      intake_gasket: 'The 3.8 is known for intake and head gasket coolant leaks. Watch for coolant loss and milky oil.',
      head_gaskets: 'The 3.8 is known for head gasket failures, often from overheating. Keep the cooling system healthy.',
      clutch_cable: 'SN95 uses a cable with a self-adjusting quadrant. Many owners swap to an aftermarket quadrant and adjustable cable.',
      egr: 'EGR with a DPFE sensor. P0401 is often the DPFE sensor or its hoses.',
      shoes_R: 'V6 cars without ABS usually have rear drums. Switch to discs in Settings if yours has them.',
    },
    specs: [
      ['Fluids', 'Engine oil', '5W-20 or 5W-30 (check oil cap / owner manual)', true],
      ['Fluids', 'Oil capacity with filter', '4.5 qt', true],
      ['Fluids', 'Oil filter', 'Motorcraft FL-820S', true],
      ['Fluids', 'Manual transmission (T-5)', 'Mercon ATF, fill to bottom of fill plug', true],
      ['Fluids', 'Rear axle (7.5")', '75W-140 synthetic + friction modifier if Traction-Lok', true],
      ['Fluids', 'Brake fluid', 'DOT 3', true],
      ['Fluids', 'Power steering', 'Mercon ATF', true],
      ['Fluids', 'Coolant', 'Check the reservoir decal for type before mixing', true],
      ['Torque', 'Lug nuts', '100 ft-lb', true],
      ['Torque', 'Oil drain plug', '', false],
      ['Torque', 'Spark plugs', '', false],
      ['Ignition', 'Spark plug gap', '0.054 in', true],
      ['Ignition', 'Firing order', '1-4-2-5-3-6', true],
      ['Tires', 'Pressure', 'See driver door placard', false],
      ['OBD', 'Protocol', 'SAE J1850 PWM (Ford 1996-2003). Adapter must support PWM.', false],
    ],
  },
  { id: 'generic-rwd-car', label: 'Generic RWD car', vehicle: { bodyColor: '#3b82f6' }, options: { ...BASE_OPTIONS, trans: 'auto', cylinders: 8 } },
  { id: 'generic-fwd-car', label: 'Generic FWD car (sedan)', vehicle: { bodyColor: '#9ca3af' },
    options: { ...BASE_OPTIONS, bodyType: 'sedan', drivetrain: 'fwd', trans: 'auto', cylinders: 4, layout: 'I', engineMount: 'transverse',
      plugWires: false, rearSuspension: 'independent', rearBrakes: 'disc', egr: false } },
  { id: 'generic-awd-suv', label: 'Generic AWD SUV', vehicle: { bodyColor: '#14532d' },
    options: { ...BASE_OPTIONS, bodyType: 'suv', drivetrain: 'awd', trans: 'auto', cylinders: 6, layout: 'V', engineMount: 'transverse',
      plugWires: false, rearSuspension: 'independent', egr: false } },
  { id: 'generic-4x4-truck', label: 'Generic 4x4 pickup', vehicle: { bodyColor: '#e5e7eb' },
    options: { ...BASE_OPTIONS, bodyType: 'truck', drivetrain: '4wd', trans: 'auto', cylinders: 8, layout: 'V', frontSuspension: 'wishbone',
      rearSuspension: 'leaf', plugWires: false, steering: 'rack', egr: false, cabinFilter: true } },
];

export const OPTION_FIELDS = [
  ['bodyType', 'Body', ['coupe', 'sedan', 'hatch', 'suv', 'truck']],
  ['drivetrain', 'Drivetrain', ['rwd', 'fwd', 'awd', '4wd']],
  ['trans', 'Transmission', ['manual', 'auto']],
  ['cylinders', 'Cylinders', [3, 4, 5, 6, 8, 10]],
  ['layout', 'Engine layout', ['I', 'V']],
  ['engineMount', 'Engine orientation', ['longitudinal', 'transverse']],
  ['timing', 'Timing drive', ['chain', 'belt']],
  ['plugWires', 'Plug wires', [true, false]],
  ['frontSuspension', 'Front suspension', ['strut', 'wishbone']],
  ['rearSuspension', 'Rear suspension', ['solid', 'independent', 'leaf']],
  ['rearBrakes', 'Rear brakes', ['disc', 'drum']],
  ['steering', 'Steering', ['rack', 'box']],
  ['cabinFilter', 'Cabin filter', [true, false]],
  ['spare', 'Spare tire', [true, false]],
  ['egr', 'EGR valve', [true, false]],
  ['dualExhaust', 'Dual exhaust', [true, false]],
  ['clutchHydraulic', 'Hydraulic clutch', [true, false]],
];

export { CORNERS, SIDE, CORNER_NAME, cap };
