// Inspection checklist and test battery. Both are generated from vehicle
// options (like the part list), so any vehicle gets a full inspection.
//
// Checklist item: { id, sec, text, parts:[partKeys], m?, crit?, how? }
//   m = measurement { label, unit, nominal, limit, apply? }
//       apply = part key whose measurement history gets the value
//       (the part's own measure must use the same unit).
//   crit = a failure here is a safety issue (flag is critical)
//
// Test: { id, name, group, parts, tools, steps, readings, criteria, evaluate? }
//   reading = { id, label, unit, nominal, limit, apply?, count?, labels? }
//       count/labels make a reading a row of values (per cylinder, per corner)
//   evaluate(values, ctx) → [{ status, text, parts? }] for rules beyond
//       simple limits (cylinder spread, etc.)
//
// Statuses: pass | watch | fail | na. A measurement past its limit is a fail;
// 80% of the way to its limit is a watch.

export const STATUS = {
  pass: { label: 'Pass', short: 'OK', level: 'green' },
  watch: { label: 'Watch', short: 'W', level: 'yellow' },
  fail: { label: 'Fail', short: 'X', level: 'red' },
  na: { label: 'N/A', short: '–', level: 'unknown' },
};

const CORNER_NAME = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };
const CORNERS = ['FL', 'FR', 'RL', 'RR'];

// Status from a measurement value. Works for lower- or higher-is-worse.
export function measureStatus(m, value) {
  if (value == null || value === '' || Number.isNaN(+value) || m.nominal == null || m.limit == null || m.nominal === m.limit) return null;
  const frac = (m.nominal - +value) / (m.nominal - m.limit);
  if (frac >= 1) return 'fail';
  if (frac >= 0.8) return 'watch';
  return 'pass';
}

export function buildInspection(o) {
  const I = [];
  const add = (sec, id, text, parts = [], extra = {}) => I.push({ sec, id, text, parts, ...extra });
  const manual = o.trans === 'manual';
  const rwdLike = o.drivetrain === 'rwd' || o.drivetrain === '4wd' || o.drivetrain === 'awd';
  const fwdLike = o.drivetrain === 'fwd' || o.drivetrain === 'awd';
  const banks = o.layout === 'V' ? ['1', '2'] : ['1'];

  // ---------- 1. Records & warning lamps ----------
  let s = 'Records & dash';
  add(s, 'rec_vin', 'VIN on dash, door and title match; no open recalls (check NHTSA by VIN)');
  add(s, 'rec_odo', 'Odometer reading recorded and working');
  add(s, 'rec_mil', 'Check engine light comes on with key on, goes off after start', ['engine']);
  add(s, 'rec_lamps', 'Oil, charge, brake, airbag and ABS lamps bulb-check then go out', ['interior', 'restraints']);
  add(s, 'rec_gauges', 'Temperature, fuel, speedometer and tach gauges work', ['interior']);

  // ---------- 2. Engine (cold, hood up) ----------
  s = 'Engine bay';
  add(s, 'eng_leaks_top', 'No oil leaks at valve covers, intake or front cover', ['valve_cover_gaskets', 'intake_gasket', 'front_cover']);
  add(s, 'eng_leaks_bottom', 'No oil leaks at oil pan, drain plug or rear main (bellhousing seam)', ['oil_pan_gasket', 'rear_main_seal']);
  add(s, 'eng_coolant_leaks', 'No coolant leaks or crust at intake, heads, water pump weep hole', ['intake_gasket', 'head_gaskets', 'water_pump']);
  add(s, 'eng_cap_sludge', 'Oil fill cap underside clean (no milky residue or sludge)', ['head_gaskets', 'intake_gasket', 'oil'], { crit: false });
  add(s, 'eng_pcv', 'PCV valve rattles when shaken; hose not cracked or oily-soft', ['pcv']);
  add(s, 'eng_vac_hoses', 'Vacuum hoses intact, connected, not cracked or collapsed', ['intake_gasket', 'pcv', 'brake_master']);
  add(s, 'eng_mounts', 'Engine mounts: no cracked rubber, engine lifts under 1/2 in on power brake test', ['engine_mount_L', 'engine_mount_R']);
  add(s, 'eng_wiring', 'Engine harness and connectors secure, no melted or chafed insulation', ['engine']);
  add(s, 'eng_noise_cold', 'Cold start: no knock, rod knock, lifter tick lasting over 30 s, or timing chain rattle', ['engine', 'timing']);
  add(s, 'eng_idle', 'Idle smooth and steady at operating temperature', ['throttle_body', 'engine']);
  add(s, 'eng_smoke', 'No blue (oil), white sweet-smelling (coolant) or black (rich) exhaust smoke', ['engine', 'head_gaskets', 'injectors']);
  add(s, 'eng_blowby', 'Little or no blow-by puffing from the oil fill with cap removed at idle', ['engine', 'pcv']);
  add(s, 'eng_cam_crank', 'Cam and crank sensor connectors clean and seated', ['cam_sensor', 'crank_sensor']);
  add(s, 'eng_engine_dress', 'Splash shields and under-engine covers in place', ['body']);

  // ---------- 3. Fluids ----------
  s = 'Fluids';
  add(s, 'fl_oil_level', 'Engine oil level between marks', ['oil']);
  add(s, 'fl_oil_cond', 'Engine oil color and smell OK (no fuel smell, no metal glitter)', ['oil', 'engine']);
  add(s, 'fl_coolant_level', 'Coolant at COLD FILL line in reservoir', ['coolant']);
  add(s, 'fl_coolant_cond', 'Coolant clean, correct color, no oil film or rust', ['coolant', 'head_gaskets']);
  add(s, 'fl_coolant_freeze', 'Coolant freeze protection', ['coolant'], { m: { label: 'Freeze point', unit: '°F', nominal: -34, limit: 0 }, how: 'Refractometer or hydrometer.' });
  add(s, 'fl_brake_level', 'Brake fluid between MIN and MAX', ['brake_fluid', 'pads_F']);
  add(s, 'fl_brake_moisture', 'Brake fluid moisture', ['brake_fluid'], { m: { label: 'Water content', unit: '%', nominal: 0, limit: 3 }, crit: true, how: 'Test strip or electronic tester. 3% or more: flush.' });
  add(s, 'fl_ps_level', 'Power steering fluid in range, not foamy or burnt', ['ps_fluid', 'ps_pump']);
  add(s, 'fl_trans', manual ? 'Manual transmission fluid at bottom of fill hole, no metal paste on drain plug magnet' : 'ATF level at operating temp, red and not burnt', ['trans_fluid', 'transmission']);
  if (rwdLike) add(s, 'fl_diff', 'Rear axle oil level at fill hole, no water or metal', ['rear_diff_fluid', 'rear_diff']);
  if (o.drivetrain === '4wd' || o.drivetrain === 'awd') add(s, 'fl_transfer', 'Transfer case / PTU fluid level and condition', ['transfer_fluid']);
  if (o.drivetrain === '4wd') add(s, 'fl_front_diff', 'Front axle oil level and condition', ['front_diff_fluid']);
  if (manual && o.clutchHydraulic) add(s, 'fl_clutch', 'Clutch fluid level and color', ['clutch_cable']);
  add(s, 'fl_washer', 'Washer fluid full', ['washer']);
  add(s, 'fl_drips', 'No fresh drips under the car after sitting overnight (note color)', ['oil_pan_gasket', 'coolant', 'trans_fluid', 'brake_lines']);

  // ---------- 4. Cooling & HVAC ----------
  s = 'Cooling & HVAC';
  add(s, 'cool_rad', 'Radiator fins clear, no leaks at tanks or seams', ['radiator']);
  add(s, 'cool_hoses', 'Upper, lower and heater hoses firm, no swelling, cracks or soft spots', ['hoses']);
  add(s, 'cool_clamps', 'Hose clamps tight, no seepage', ['hoses']);
  add(s, 'cool_cap', 'Radiator / reservoir cap seal intact', ['rad_cap']);
  add(s, 'cool_fan', 'Cooling fan runs when hot and with A/C on; no wobble or broken blades', ['fan']);
  add(s, 'cool_temp', 'Engine reaches normal temp and stays there (no creeping)', ['thermostat', 'radiator', 'fan']);
  add(s, 'cool_pump', 'Water pump: no weep, no shaft play, no bearing noise', ['water_pump']);
  add(s, 'cool_heat', 'Heater blows hot on both sides; no sweet smell or foggy windshield', ['heater_core']);
  add(s, 'cool_ac', 'A/C blows cold; compressor clutch engages and cycles normally', ['ac_system'], { m: { label: 'Center vent temp', unit: '°F', nominal: 40, limit: 55 } });
  add(s, 'cool_blower', 'Blower works on every speed and all vent modes switch', ['interior']);
  add(s, 'cool_reservoir', 'Coolant reservoir not cracked; overflow hose connected', ['coolant']);

  // ---------- 5. Accessory drive ----------
  s = 'Belts & accessory drive';
  add(s, 'belt_cracks', 'Serpentine belt: no cracks deeper than the rib, no missing chunks, no glazing', ['belt']);
  add(s, 'belt_wear', 'Belt rib wear (gauge drops in = replace)', ['belt']);
  add(s, 'belt_tensioner', 'Tensioner arm within wear marks, no bounce at idle', ['tensioner']);
  add(s, 'belt_pulleys', 'Idler/tensioner pulleys spin quietly with belt off, no play', ['tensioner']);
  add(s, 'belt_align', 'All pulleys aligned; no chirp or squeal', ['belt', 'alternator', 'ps_pump', 'water_pump']);
  add(s, 'belt_alt_brg', 'Alternator pulley bearing quiet', ['alternator']);
  add(s, 'belt_ps_noise', 'Power steering pump quiet lock to lock', ['ps_pump']);

  // ---------- 6. Ignition ----------
  s = 'Ignition';
  add(s, 'ign_plugs', 'Spark plugs read: tan electrodes, no oil fouling, no white blistering', ['plugs', 'engine']);
  add(s, 'ign_gap', 'Spark plug gap within spec', ['plugs']);
  if (o.plugWires) add(s, 'ign_wires', 'Plug wires: no cracks, burns or arcing (mist test in the dark)', ['plug_wires']);
  add(s, 'ign_coil', 'Coil pack / coils: no cracks, carbon tracking or oil in boots', ['coils']);
  add(s, 'ign_misfire', 'No misfire felt at idle or under load', ['plugs', 'coils', 'injectors']);

  // ---------- 7. Fuel & air ----------
  s = 'Fuel & air intake';
  add(s, 'fuel_smell', 'No raw fuel smell under hood or near tank', ['injectors', 'fuel_tank', 'evap'], { crit: true });
  add(s, 'fuel_rail', 'Fuel rail, injector O-rings and lines dry', ['injectors'], { crit: true });
  add(s, 'fuel_lines', 'Fuel lines along frame not rusted, kinked or leaking', ['fuel_filter', 'fuel_tank'], { crit: true });
  add(s, 'fuel_pump_prime', 'Fuel pump primes for ~2 s at key on; no whine', ['fuel_pump']);
  add(s, 'fuel_cap', 'Gas cap seal intact and clicks', ['evap']);
  add(s, 'fuel_tank_straps', 'Fuel tank straps and filler neck not rusted', ['fuel_tank']);
  add(s, 'air_filter', 'Air filter clean enough to see light through', ['air_filter']);
  add(s, 'air_tube', 'Intake tube and couplers not cracked; no unmetered air after the MAF', ['maf', 'air_filter']);
  add(s, 'air_maf', 'MAF wire clean (no lint or oil)', ['maf']);
  add(s, 'air_tb', 'Throttle body bore free of heavy carbon; throttle snaps shut', ['throttle_body']);
  if (o.cabinFilter) add(s, 'air_cabin', 'Cabin filter clean', ['cabin_filter']);

  // ---------- 8. Electrical ----------
  s = 'Battery & charging';
  add(s, 'el_batt_terms', 'Battery terminals clean and tight, no corrosion', ['battery']);
  add(s, 'el_batt_case', 'Battery case not swollen or leaking; hold-down tight', ['battery']);
  add(s, 'el_batt_age', 'Battery date code recorded (age)', ['battery']);
  add(s, 'el_batt_v', 'Battery resting voltage (engine off 2+ h)', ['battery'], { m: { label: 'Resting voltage', unit: 'V', nominal: 12.7, limit: 12.2, apply: 'battery' } });
  add(s, 'el_charge_v', 'Charging voltage at 2000 rpm, loads off', ['alternator'], { m: { label: 'Charging voltage', unit: 'V', nominal: 14.2, limit: 13.2, apply: 'alternator' } });
  add(s, 'el_grounds', 'Engine-to-body and battery-to-body grounds tight and clean', ['battery', 'starter']);
  add(s, 'el_starter', 'Starter cranks strongly, no grinding or slow crank', ['starter', 'battery']);
  add(s, 'el_fuses', 'Fuses and relays in place; no green corrosion in the boxes', ['interior']);

  // ---------- 9. Lights & body ----------
  s = 'Lights, glass & body';
  add(s, 'lt_low', 'Low beams both sides', ['headlights'], { crit: true });
  add(s, 'lt_high', 'High beams and indicator', ['headlights']);
  add(s, 'lt_aim', 'Headlight aim correct; lenses not yellowed', ['headlights']);
  add(s, 'lt_park', 'Parking and side marker lights', ['headlights', 'taillights']);
  add(s, 'lt_turn', 'Turn signals front and rear, normal flash rate', ['headlights', 'taillights'], { crit: true });
  add(s, 'lt_hazard', 'Hazard flashers', ['taillights']);
  add(s, 'lt_brake', 'Brake lights including third brake light', ['taillights'], { crit: true });
  add(s, 'lt_tail', 'Tail lights', ['taillights']);
  add(s, 'lt_reverse', 'Reverse lights', ['taillights']);
  add(s, 'lt_plate', 'License plate light', ['taillights']);
  add(s, 'lt_interior', 'Dome, map and dash lights', ['interior']);
  add(s, 'gl_windshield', 'Windshield: no cracks in the driver view; chips repaired', ['body'], { crit: true });
  add(s, 'gl_wipers', 'Wiper blades clear cleanly, no streaks; all speeds and park', ['wipers']);
  add(s, 'gl_washer', 'Washers spray on the glass', ['washer']);
  add(s, 'gl_mirrors', 'Mirrors intact and adjust', ['body']);
  add(s, 'gl_windows', 'Windows go up and down at normal speed', ['body']);
  add(s, 'body_doors', 'Doors, hood and trunk open, latch and lock; hood safety catch works', ['body'], { crit: true });
  add(s, 'body_hinges', 'Door hinges: no sag (lift door at the end to check pin wear)', ['body']);
  add(s, 'body_seals', 'Weatherstrips sealed; no water in trunk or footwells', ['body']);
  add(s, 'body_horn', 'Horn', ['washer'], { crit: true });
  add(s, 'body_rust', 'Rocker panels, wheel arches, trunk floor: no rot-through', ['chassis']);
  add(s, 'body_frame', 'Frame rails, torque boxes and subframe mounts: no cracks, rot or crash damage', ['chassis'], { crit: true });
  add(s, 'body_floor', 'Floor pans solid from underneath', ['chassis']);
  add(s, 'body_shields', 'Heat shields secure (no rattles)', ['exhaust']);

  // ---------- 10. Interior & safety ----------
  s = 'Interior & safety';
  add(s, 'int_belts', 'Every seat belt latches, releases and retracts; webbing not frayed', ['restraints'], { crit: true });
  add(s, 'int_airbag', 'Airbag light goes out after start', ['restraints'], { crit: true });
  add(s, 'int_seats', 'Seats lock in position; seat tracks solid', ['interior']);
  add(s, 'int_switches', 'Window, lock, mirror and HVAC switches work', ['interior']);
  add(s, 'int_defrost', 'Defroster clears front glass; rear defrost works', ['interior', 'heater_core']);
  add(s, 'int_pedals', 'Pedal pads present; nothing under the pedals', ['interior']);
  add(s, 'int_kit', 'Jack, lug wrench and spare present', ['tire_SP']);

  // ---------- 11. Brakes ----------
  s = 'Brakes';
  add(s, 'br_pedal', 'Pedal firm and high; does not sink when held 30 s', ['brake_master', 'brake_fluid'], { crit: true });
  add(s, 'br_booster', 'Booster: pedal drops slightly when engine starts with foot on pedal', ['brake_master'], { crit: true });
  add(s, 'br_mc_leak', 'Master cylinder: no leak at reservoir seals or booster joint', ['brake_master'], { crit: true });
  add(s, 'br_hoses', 'Flex hoses: no cracks, bulges or twisting lock to lock', ['brake_lines'], { crit: true });
  add(s, 'br_lines', 'Hard lines: no heavy rust, flaking or wet fittings', ['brake_lines'], { crit: true });
  add(s, 'br_parking', 'Parking brake holds on a slope within 3-8 clicks', ['parking_brake'], { crit: true });
  add(s, 'br_pb_cables', 'Parking brake cables move freely; no frayed strands', ['parking_brake']);
  for (const k of CORNERS) {
    const front = k[0] === 'F';
    const n = CORNER_NAME[k];
    if (!front && o.rearBrakes === 'drum') {
      add(s, `br_shoe_${k}`, `Shoe lining ${n}`, ['shoes_R'], { m: { label: 'Lining thickness', unit: 'mm', nominal: 5, limit: 1.5, apply: 'shoes_R' }, crit: true });
      add(s, `br_drum_${k}`, `Drum ${n}: no scoring, cracks or heat spots; diameter within the max cast inside`, ['drums_R'], { crit: true });
      add(s, `br_wc_${k}`, `Wheel cylinder ${n}: boots dry, no fluid behind the dust boot`, ['drums_R'], { crit: true });
      add(s, `br_drumhw_${k}`, `Drum hardware ${n}: springs intact, self-adjuster turns`, ['drums_R']);
      continue;
    }
    const ax = front ? 'F' : 'R';
    add(s, `br_pad_${k}`, `Pad thickness ${n} (thinnest of inner/outer)`, [`pads_${ax}`], { m: { label: 'Pad thickness', unit: 'mm', nominal: front ? 11 : 9, limit: 3, apply: `pads_${ax}` }, crit: true });
    add(s, `br_rotor_${k}`, `Rotor ${n}: no deep grooves, cracks, heavy lip or blue spots`, [`rotors_${ax}`], { crit: true });
    add(s, `br_rotor_th_${k}`, `Rotor thickness ${n} vs MIN TH cast on rotor`, [`rotors_${ax}`], { m: { label: 'Rotor thickness', unit: 'mm', nominal: null, limit: null } });
    add(s, `br_caliper_${k}`, `Caliper ${n}: no leak, piston boot intact, slides move freely`, [`caliper_${k}`], { crit: true });
  }

  // ---------- 12. Tires & wheels ----------
  s = 'Tires & wheels';
  for (const k of CORNERS) {
    const n = CORNER_NAME[k];
    add(s, `ti_tread_${k}`, `Tread depth ${n} (lowest groove)`, [`tire_${k}`], { m: { label: 'Tread depth', unit: '/32"', nominal: 10, limit: 2, apply: `tire_${k}` }, crit: true });
    add(s, `ti_wear_${k}`, `Wear pattern ${n}: even (no inner/outer edge, cupping or feathering)`, [`tire_${k}`, 'alignment']);
    add(s, `ti_side_${k}`, `Sidewall ${n}: no bulges, cuts, cracking; DOT date recorded`, [`tire_${k}`], { crit: true });
    add(s, `ti_psi_${k}`, `Cold pressure ${n} set to placard`, [`tire_${k}`], { m: { label: 'Cold pressure', unit: 'psi', nominal: null, limit: null } });
    add(s, `ti_wheel_${k}`, `Wheel ${n}: no bends or cracks; lug nuts torqued; studs undamaged`, [`tire_${k}`, `bearing_${k}`], { crit: true });
    add(s, `ti_bearing_${k}`, `Wheel bearing ${n}: no play (12-6 o'clock rock) or growl when spun`, [`bearing_${k}`], { crit: true });
  }
  if (o.spare) add(s, 'ti_spare', 'Spare: pressure set, not dry-rotted', ['tire_SP']);

  // ---------- 13. Suspension ----------
  s = 'Suspension';
  for (const k of CORNERS) {
    const n = CORNER_NAME[k];
    const front = k[0] === 'F';
    const damper = front && o.frontSuspension === 'strut' ? `strut_${k}` : `shock_${k}`;
    add(s, `su_damper_${k}`, `${front && o.frontSuspension === 'strut' ? 'Strut' : 'Shock'} ${n}: no oil, bounce settles in one cycle`, [damper]);
    add(s, `su_spring_${k}`, `Spring ${n}: not broken or sagging; isolators present`, [`spring_${k}`], { crit: true });
    if (front) {
      add(s, `su_lca_${k}`, `Lower control arm bushings ${n}: not torn or shifted`, [`lca_${k}`]);
      add(s, `su_bj_${k}`, `Ball joint ${n}: no play (pry test), boot intact`, [`balljoint_${k}`], { crit: true });
      if (o.frontSuspension === 'strut') add(s, `su_mount_${k}`, `Strut mount ${n}: no clunk, no binding when steering`, [`strut_mount_${k}`]);
      if (o.frontSuspension === 'wishbone') add(s, `su_uca_${k}`, `Upper control arm ${n}: bushings and ball joint`, [`uca_${k}`], { crit: true });
    } else if (o.rearSuspension === 'solid') {
      add(s, `su_rlca_${k}`, `Rear lower arm ${n}: bushings, no bent arm`, [`rear_lca_${k}`]);
      add(s, `su_ruca_${k}`, `Rear upper arm ${n}: bushings at body and axle housing`, [`rear_uca_${k}`]);
    } else if (o.rearSuspension === 'independent') {
      add(s, `su_rarms_${k}`, `Rear arms & bushings ${n}`, [`rear_arms_${k}`]);
    }
  }
  add(s, 'su_sway_f', 'Front sway bar links and bushings: no clunk or torn rubber', ['sway_F']);
  add(s, 'su_sway_r', 'Rear sway bar links and bushings', ['sway_R']);
  add(s, 'su_height', 'Ride height even side to side and front to rear', ['spring_FL', 'spring_FR', 'spring_RL', 'spring_RR']);

  // ---------- 14. Steering ----------
  s = 'Steering';
  add(s, 'st_play', 'Steering wheel free play under 1 in at the rim (engine running)', ['steering_rack', 'tierod_L', 'tierod_R'], { crit: true });
  add(s, 'st_tr_L', 'Left tie rod ends (inner and outer): no play', ['tierod_L'], { crit: true });
  add(s, 'st_tr_R', 'Right tie rod ends (inner and outer): no play', ['tierod_R'], { crit: true });
  add(s, 'st_boots', o.steering === 'box' ? 'Steering box: no leaks, mounting bolts tight' : 'Rack boots intact and dry (wet boot = inner seal leak)', ['steering_rack']);
  add(s, 'st_rack_bush', o.steering === 'box' ? 'Pitman arm and idler arm tight' : 'Rack mounting bushings not torn', ['steering_rack']);
  add(s, 'st_ps_hoses', 'Power steering hoses dry, not rubbing', ['ps_pump', 'steering_rack']);
  add(s, 'st_column', 'Steering shaft / column joints: no clunk or binding', ['steering_rack']);
  add(s, 'st_return', 'Wheel returns to center after a turn', ['steering_rack', 'alignment']);

  // ---------- 15. Drivetrain ----------
  s = 'Drivetrain';
  if (manual) {
    add(s, 'dt_clutch_engage', 'Clutch engages smoothly, not at the very top or floor', ['clutch', 'clutch_cable']);
    add(s, 'dt_clutch_slip', 'No slip in 3rd/4th at full throttle from low rpm', ['clutch']);
    add(s, 'dt_clutch_noise', 'No throwout bearing chirp/whir with the pedal pressed or released', ['clutch']);
    add(s, 'dt_clutch_cable', o.clutchHydraulic ? 'Clutch master/slave: no leaks, pedal returns' : 'Clutch cable, quadrant and firewall adjuster: no fraying, no broken teeth', ['clutch_cable']);
    add(s, 'dt_shift', 'Shifts into every gear without grinding; no pop-out', ['transmission']);
  } else {
    add(s, 'dt_shift_auto', 'Shifts smoothly and on time; no flare, slip or harsh engagement', ['transmission', 'trans_fluid']);
  }
  add(s, 'dt_trans_leak', 'Transmission: no leaks at seals or case', ['transmission']);
  if (rwdLike || o.drivetrain === 'awd') add(s, 'dt_trans_mount', 'Transmission mount not torn or collapsed', ['trans_mount']);
  if (rwdLike) {
    add(s, 'dt_ujoints', 'Driveshaft U-joints: no play or rust dust; no vibration', ['driveshaft'], { crit: true });
    add(s, 'dt_ds_bolts', 'Driveshaft flange bolts tight', ['driveshaft'], { crit: true });
    add(s, 'dt_pinion', 'Pinion seal dry; no clunk on throttle on/off', ['rear_diff']);
    add(s, 'dt_diff_noise', 'Rear axle: no whine on accel or coast, no clunk', ['rear_diff']);
    add(s, 'dt_diff_vent', 'Axle vent clear; housing and cover dry', ['rear_diff', 'rear_diff_fluid']);
    if (o.rearSuspension === 'solid') add(s, 'dt_axle_seals', 'Axle seals dry (no gear oil on brake backing plates)', ['axle_seals']);
  }
  for (const sd of ['L', 'R']) {
    if (fwdLike || o.drivetrain === '4wd') add(s, `dt_fcv_${sd}`, `Front CV ${sd === 'L' ? 'left' : 'right'}: boots intact, no clicking in turns`, [`front_cv_${sd}`]);
    if (rwdLike && o.rearSuspension !== 'solid') add(s, `dt_rcv_${sd}`, `Rear CV ${sd === 'L' ? 'left' : 'right'}: boots intact`, [`rear_cv_${sd}`]);
  }

  // ---------- 16. Exhaust & emissions ----------
  s = 'Exhaust & emissions';
  add(s, 'ex_leaks', 'No exhaust leaks (ticking at manifolds, black soot at joints)', ['exhaust'], { crit: true });
  add(s, 'ex_hangers', 'Hangers and isolators intact; nothing touches the body', ['exhaust']);
  add(s, 'ex_pipes', 'Pipes and mufflers: no holes or rot-through', ['exhaust', 'muffler']);
  for (const b of banks) add(s, `ex_cat_${b}`, `Catalytic converter${banks.length > 1 ? ` bank ${b}` : ''}: no rattle when tapped, not glowing or discolored`, [`cat_${b}`]);
  for (const b of banks) add(s, `ex_o2_${b}`, `O2 sensor wiring${banks.length > 1 ? ` bank ${b}` : ''} clear of exhaust`, [`o2_up_${b}`, `o2_down_${b}`]);
  if (o.egr) add(s, 'ex_egr', 'EGR valve, tube and DPFE hoses intact (no cracked hoses)', ['egr']);
  add(s, 'ex_evap', 'EVAP canister and lines intact', ['evap']);
  add(s, 'ex_co_cabin', 'No exhaust smell in the cabin', ['exhaust', 'body'], { crit: true });

  // ---------- 17. Road test ----------
  s = 'Road test';
  add(s, 'rt_straight', 'Tracks straight with hands light on the wheel', ['alignment', 'tire_FL', 'tire_FR']);
  add(s, 'rt_center', 'Steering wheel centered when driving straight', ['alignment']);
  add(s, 'rt_brake_pull', 'Brakes stop straight with no pull, pulsation or squeal', ['pads_F', 'rotors_F', 'caliper_FL', 'caliper_FR'], { crit: true });
  add(s, 'rt_panic', 'Hard stop from 30 mph: straight, no lockup on one side', ['brake_master', 'pads_F'], { crit: true });
  add(s, 'rt_vibe', 'No vibration at 50-70 mph (wheel balance, driveshaft)', ['tire_FL', 'tire_FR', 'tire_RL', 'tire_RR', 'driveshaft']);
  add(s, 'rt_bumps', 'No clunks or rattles over bumps', ['sway_F', 'sway_R', 'strut_mount_FL', 'strut_mount_FR']);
  add(s, 'rt_bearing_hum', 'No wheel bearing hum that changes when swerving', ['bearing_FL', 'bearing_FR', 'bearing_RL', 'bearing_RR']);
  add(s, 'rt_power', 'Full-throttle acceleration: no hesitation, misfire or ping', ['engine', 'fuel_pump', 'plugs', 'coils']);
  add(s, 'rt_cruise', 'Cruise control works (if equipped)', ['interior']);
  add(s, 'rt_speedo', 'Speedometer matches GPS within 3 mph', ['interior']);
  add(s, 'rt_temp_after', 'After drive: temp normal, no new leaks or smells', ['thermostat', 'coolant']);

  // ---------- 18. OBD ----------
  s = 'OBD-II';
  add(s, 'obd_dtc', 'No stored, pending or permanent trouble codes', ['engine']);
  add(s, 'obd_ready', 'All readiness monitors complete', ['engine', 'cat_1', 'o2_up_1', 'evap']);
  add(s, 'obd_ltft', 'Long-term fuel trims within ±10% each bank at idle and 2500 rpm', ['maf', 'injectors', 'intake_gasket', 'fuel_pump'], { m: { label: 'Worst LTFT (absolute)', unit: '%', nominal: 0, limit: 10 } });
  add(s, 'obd_ect', 'Coolant temp on scan tool matches gauge and reaches 195-220 °F', ['thermostat']);
  add(s, 'obd_o2', 'Upstream O2 switching; downstream steady (cat efficiency)', ['o2_up_1', 'o2_down_1', 'cat_1']);
  add(s, 'obd_maf', 'MAF g/s at warm idle recorded and compared with past inspections', ['maf']);

  return I;
}

// ---------- Test battery ----------
const cylLabels = (n) => Array.from({ length: n }, (_, i) => `Cyl ${i + 1}`);
const spreadPct = (vals) => {
  const xs = vals.filter((x) => x != null && x !== '' && !Number.isNaN(+x)).map(Number);
  if (xs.length < 2) return null;
  return ((Math.max(...xs) - Math.min(...xs)) / Math.max(...xs)) * 100;
};

export function buildTests(o) {
  const T = [];
  const add = (t) => T.push({ parts: [], tools: [], steps: [], readings: [], ...t });
  const cyl = o.cylinders || 4;
  const manual = o.trans === 'manual';
  const rwdLike = o.drivetrain === 'rwd' || o.drivetrain === '4wd' || o.drivetrain === 'awd';
  const banks = o.layout === 'V' ? 2 : 1;

  // ---- Engine mechanical ----
  add({ id: 't_compression', group: 'Engine mechanical', name: 'Compression test (dry and wet)', parts: ['engine', 'head_gaskets'],
    tools: ['Screw-in compression gauge', 'Remote starter or helper', 'Oil can'],
    steps: ['Warm engine, then shut off.', 'Disable fuel (pull fuel pump relay or inertia switch) and ignition.', 'Remove all spark plugs.', 'Throttle wide open. Crank 5-6 compression strokes per cylinder; record the highest reading.', 'For any low cylinder, add a teaspoon of oil and retest (wet).'],
    readings: [
      { id: 'dry', label: 'Dry compression', unit: 'psi', count: cyl, labels: cylLabels(cyl), nominal: 170, limit: 120, apply: 'engine', applyAs: 'min' },
      { id: 'wet', label: 'Wet compression (low cylinders only)', unit: 'psi', count: cyl, labels: cylLabels(cyl), optional: true },
    ],
    criteria: 'Lowest cylinder at least 75% of the highest (Ford rule). Wet rise of 10%+ points to rings; no rise points to valves or head gasket. Two low adjacent cylinders suggest a head gasket.',
    evaluate: (v) => {
      const out = [];
      const sp = spreadPct(v.dry || []);
      if (sp != null) out.push({ status: sp > 25 ? 'fail' : sp > 15 ? 'watch' : 'pass', text: `Cylinder spread ${sp.toFixed(0)}%` });
      const dry = v.dry || [], wet = v.wet || [];
      for (let i = 0; i < cyl; i++) if (wet[i] && dry[i] && +wet[i] > +dry[i] * 1.1) out.push({ status: 'watch', text: `Cyl ${i + 1} rises wet (${dry[i]}→${wet[i]}): ring wear` });
      // Neighbors on the same bank (Ford-style numbering: bank 1 = 1..n/2).
      const bank = o.layout === 'V' ? cyl / 2 : cyl;
      for (let i = 0; i < cyl - 1; i++) {
        if ((i + 1) % bank === 0) continue;
        const a = +dry[i], b = +dry[i + 1];
        const max = Math.max(...dry.filter(Boolean).map(Number));
        if (a && b && a < max * 0.8 && b < max * 0.8) out.push({ status: 'fail', text: `Cyl ${i + 1} and ${i + 2} both low: possible head gasket`, parts: ['head_gaskets'] });
      }
      return out;
    } });
  add({ id: 't_leakdown', group: 'Engine mechanical', name: 'Cylinder leak-down test', parts: ['engine', 'head_gaskets'],
    tools: ['Leak-down tester', 'Air compressor (90-100 psi)', 'Breaker bar on crank bolt'],
    steps: ['Engine warm, plugs out.', 'Bring each cylinder to TDC on compression.', 'Apply regulated air; record % leakage.', 'Listen: intake/throttle = intake valve, tailpipe = exhaust valve, oil fill = rings, bubbles in radiator = head gasket.'],
    readings: [{ id: 'leak', label: 'Leakage', unit: '%', count: cyl, labels: cylLabels(cyl), nominal: 0, limit: 20, apply: null }],
    criteria: 'Under 10% good, 10-20% worn, over 20% needs repair.' });
  add({ id: 't_vacuum', group: 'Engine mechanical', name: 'Engine vacuum test', parts: ['engine', 'intake_gasket', 'exhaust', 'timing'],
    tools: ['Vacuum gauge'],
    steps: ['Tee gauge into a manifold vacuum source.', 'Warm idle: record reading and needle behavior.', 'Hold 2500 rpm for 30 s: vacuum should hold or rise. A slow drop means exhaust restriction.', 'Snap throttle: should drop near 0 then overshoot.'],
    readings: [{ id: 'idle', label: 'Idle vacuum', unit: 'inHg', nominal: 20, limit: 15 }, { id: 'hold', label: 'After 30 s at 2500 rpm', unit: 'inHg', nominal: 21, limit: 15 }],
    criteria: '17-21 inHg steady at idle at sea level. Steady low = late timing or vacuum leak; regular drop = burnt valve; wandering = rich/lean or worn guides.' });
  add({ id: 't_oil_pressure', group: 'Engine mechanical', name: 'Oil pressure test (mechanical gauge)', parts: ['engine', 'oil'],
    tools: ['Mechanical oil pressure gauge & adapter'],
    steps: ['Replace sender with gauge.', 'Record hot idle and 2000-2500 rpm.'],
    readings: [{ id: 'idle', label: 'Hot idle', unit: 'psi', nominal: 25, limit: 6 }, { id: 'rpm', label: 'At 2500 rpm', unit: 'psi', nominal: 50, limit: 20 }],
    criteria: 'Rule of thumb: 10 psi per 1000 rpm. Check service manual for the engine-specific minimum.' });
  add({ id: 't_blowby', group: 'Engine mechanical', name: 'Crankcase blow-by check', parts: ['engine', 'pcv'],
    tools: ['Glove or PCV vacuum check card'],
    steps: ['At warm idle, remove oil fill cap.', 'Observe pulsing or smoke. Place cap/glove over opening: should pull slight vacuum with PCV working.'],
    readings: [] , criteria: 'Steady light vapor is normal; strong pulsing puffs mean ring or valve guide wear.' });
  add({ id: 't_chain_stretch', group: 'Engine mechanical', name: o.timing === 'belt' ? 'Timing belt inspection' : 'Timing chain slack check', parts: ['timing'],
    tools: ['Breaker bar', 'Distributor cap or cam position reference'],
    steps: o.timing === 'belt' ? ['Remove the upper cover.', 'Check for cracks, missing teeth, glazing, oil contamination.'] : ['Rotate crank one way until the cam moves, then reverse and measure degrees of crank rotation before the cam moves.'],
    readings: o.timing === 'belt' ? [] : [{ id: 'slack', label: 'Crank degrees of slack', unit: '°', nominal: 0, limit: 8 }],
    criteria: 'More than about 5-8° of crank slack before the cam moves indicates a stretched chain.' });

  // ---- Cooling ----
  add({ id: 't_cool_pressure', group: 'Cooling', name: 'Cooling system pressure test', parts: ['radiator', 'hoses', 'water_pump', 'heater_core', 'head_gaskets', 'intake_gasket'],
    tools: ['Cooling system pressure tester'],
    steps: ['Engine cold.', 'Pump to the cap rating stamped on the cap.', 'Hold 15 minutes. Look for drips, especially at the intake, water pump and heater hoses.'],
    readings: [{ id: 'start', label: 'Pressure applied', unit: 'psi' }, { id: 'drop', label: 'Drop after 15 min', unit: 'psi', nominal: 0, limit: 3 }],
    criteria: 'No drop. A drop with no external leak points to heater core, head gasket or intake gasket.' });
  add({ id: 't_cap', group: 'Cooling', name: 'Radiator cap test', parts: ['rad_cap'], tools: ['Pressure tester & cap adapter'],
    steps: ['Pump cap until it vents; it should hold close to its rating.'],
    readings: [{ id: 'hold', label: 'Cap holds', unit: 'psi', nominal: 16, limit: 12 }], criteria: 'Within 2-3 psi of the stamped rating.' });
  add({ id: 't_combustion_gas', group: 'Cooling', name: 'Combustion leak (block) test', parts: ['head_gaskets'],
    tools: ['Block tester with blue test fluid'],
    steps: ['Coolant level lowered slightly, engine warm.', 'Draw air from the radiator neck through the fluid for 1 min.'],
    readings: [], criteria: 'Fluid turns yellow = exhaust gas in coolant (head gasket or cracked head). Stays blue = pass.' });
  add({ id: 't_thermostat', group: 'Cooling', name: 'Thermostat / warm-up test', parts: ['thermostat', 'fan'], tools: ['Scan tool or IR thermometer'],
    steps: ['Cold start, watch coolant temp PID.', 'Upper hose stays cool until the thermostat opens, then gets hot quickly.', 'Note fan-on temperature.'],
    readings: [{ id: 'open', label: 'Opening temperature', unit: '°F' }, { id: 'warm', label: 'Minutes to normal temp (idle)', unit: 'min', nominal: 8, limit: 20 }],
    criteria: 'Opens near its stamped rating; temperature stable once warm.' });
  add({ id: 't_coolant_quality', group: 'Cooling', name: 'Coolant condition (freeze, pH, voltage)', parts: ['coolant'],
    tools: ['Refractometer', 'pH strips', 'Multimeter'],
    steps: ['Measure freeze point.', 'Dip pH strip.', 'Multimeter: negative on battery, positive probe in coolant (engine running).'],
    readings: [{ id: 'freeze', label: 'Freeze point', unit: '°F', nominal: -34, limit: 0 }, { id: 'ph', label: 'pH', unit: 'pH' }, { id: 'volts', label: 'Stray voltage', unit: 'V', nominal: 0, limit: 0.3 }],
    criteria: 'Freeze point below -20 °F, pH 8-10.5, stray voltage under 0.3 V (higher = bad ground or worn coolant).' });

  // ---- Fuel ----
  add({ id: 't_fuel_pressure', group: 'Fuel', name: 'Fuel pressure & hold test', parts: ['fuel_pump', 'fuel_filter', 'injectors'],
    tools: ['Fuel pressure gauge for Schrader valve on rail'],
    steps: ['Connect gauge to the rail test port.', 'Key on engine off (KOEO): record.', 'Idle: record. Pinch or pull vacuum on the regulator if it has one: pressure should rise.', 'Shut off: record pressure after 5 minutes.'],
    readings: [{ id: 'koeo', label: 'Key on, engine off', unit: 'psi' }, { id: 'idle', label: 'Idle', unit: 'psi' }, { id: 'hold', label: 'Drop after 5 min off', unit: 'psi', nominal: 0, limit: 10 }],
    criteria: 'Compare to the engine-specific spec (set it on the reading). A fast bleed-down points to a leaking injector, regulator or pump check valve.' });
  add({ id: 't_injector_balance', group: 'Fuel', name: 'Injector balance test', parts: ['injectors'],
    tools: ['Fuel pressure gauge', 'Injector pulse tester or scan tool'],
    steps: ['Pressurize the rail, then pulse each injector for the same time.', 'Record pressure drop for each.'],
    readings: [{ id: 'drop', label: 'Pressure drop', unit: 'psi', count: cyl, labels: cylLabels(cyl) }],
    criteria: 'Each drop within ±10% of the average.',
    evaluate: (v) => { const sp = spreadPct(v.drop || []); return sp == null ? [] : [{ status: sp > 20 ? 'fail' : sp > 10 ? 'watch' : 'pass', text: `Injector flow spread ${sp.toFixed(0)}%` }]; } });
  add({ id: 't_injector_ohm', group: 'Fuel', name: 'Injector resistance', parts: ['injectors'], tools: ['Multimeter'],
    steps: ['Unplug each injector; measure across terminals.'],
    readings: [{ id: 'ohm', label: 'Resistance', unit: 'Ω', count: cyl, labels: cylLabels(cyl) }],
    criteria: 'All within about 1 Ω of each other and in the injector spec range (high-impedance injectors are usually 12-16 Ω).',
    evaluate: (v) => { const xs = (v.ohm || []).filter(Boolean).map(Number); if (xs.length < 2) return []; const d = Math.max(...xs) - Math.min(...xs); return [{ status: d > 1.5 ? 'fail' : d > 1 ? 'watch' : 'pass', text: `Resistance spread ${d.toFixed(1)} Ω` }]; } });
  add({ id: 't_evap_smoke', group: 'Fuel', name: 'EVAP / intake smoke test', parts: ['evap', 'intake_gasket', 'pcv'], tools: ['Smoke machine'],
    steps: ['Introduce smoke into the intake (engine off) and look for leaks at the gaskets, hoses and PCV.', 'Repeat on the EVAP service port with the vent closed.'],
    readings: [], criteria: 'No smoke escaping.' });

  // ---- Ignition ----
  add({ id: 't_ign_resistance', group: 'Ignition', name: o.plugWires ? 'Coil & plug wire resistance' : 'Coil resistance', parts: ['coils', 'plug_wires'], tools: ['Multimeter'],
    steps: ['Measure each coil primary and secondary.', o.plugWires ? 'Measure each plug wire end to end.' : 'Swap a suspect coil to another cylinder to see if a misfire follows.'],
    readings: [
      { id: 'primary', label: 'Coil primary', unit: 'Ω' },
      ...(o.plugWires ? [{ id: 'wires', label: 'Wire resistance', unit: 'kΩ', count: cyl, labels: cylLabels(cyl) }] : []),
    ],
    criteria: 'Plug wires typically under about 7 kΩ per foot and similar to each other. Coil values per the service manual.' });
  add({ id: 't_misfire', group: 'Ignition', name: 'Misfire counts (Mode 6 / live)', parts: ['plugs', 'coils', 'injectors', 'engine'], tools: ['Scan tool with Mode 6 or misfire PIDs'],
    steps: ['Drive at least 10 minutes, then read misfire counters per cylinder.'],
    readings: [{ id: 'mf', label: 'Misfire count', unit: 'count', count: cyl, labels: cylLabels(cyl), nominal: 0, limit: 50 }],
    criteria: 'Near zero on every cylinder.' });

  // ---- Electrical ----
  add({ id: 't_battery', group: 'Electrical', name: 'Battery state & load test', parts: ['battery'], tools: ['Multimeter', 'Carbon pile or electronic battery tester'],
    steps: ['Car off 2+ hours: record resting voltage.', 'Load test at half CCA for 15 s (or run an electronic tester); record minimum voltage and measured CCA.'],
    readings: [{ id: 'ocv', label: 'Resting voltage', unit: 'V', nominal: 12.7, limit: 12.2, apply: 'battery' }, { id: 'load', label: 'Voltage under load', unit: 'V', nominal: 10.5, limit: 9.6 }, { id: 'cca', label: 'Measured CCA (% of rated)', unit: '%', nominal: 100, limit: 70 }],
    criteria: 'Above 9.6 V under load at 70 °F. Measured CCA over 70% of rating.' });
  add({ id: 't_cranking', group: 'Electrical', name: 'Cranking voltage & starter draw', parts: ['starter', 'battery'], tools: ['Multimeter', 'Inductive amp clamp'],
    steps: ['Disable fuel. Crank 10 s.', 'Record lowest battery voltage and average starter amps.'],
    readings: [{ id: 'v', label: 'Cranking voltage', unit: 'V', nominal: 10.5, limit: 9.6 }, { id: 'a', label: 'Starter current', unit: 'A', nominal: 150, limit: 250 }],
    criteria: 'Above 9.6 V; amps within spec (high draw = tight engine or bad starter).' });
  add({ id: 't_charging', group: 'Electrical', name: 'Charging system output', parts: ['alternator', 'belt'], tools: ['Multimeter', 'Amp clamp'],
    steps: ['2000 rpm, loads off: voltage.', 'All loads on (lights high, blower high, defrost): voltage and amps.', 'AC ripple at the alternator output.'],
    readings: [{ id: 'nl', label: 'No load', unit: 'V', nominal: 14.2, limit: 13.2, apply: 'alternator' }, { id: 'fl', label: 'Full load', unit: 'V', nominal: 13.8, limit: 12.8 }, { id: 'ripple', label: 'AC ripple', unit: 'V AC', nominal: 0, limit: 0.5 }],
    criteria: '13.5-14.8 V. AC ripple under 0.5 V (more = failing diode).' });
  add({ id: 't_voltage_drop', group: 'Electrical', name: 'Voltage drop (cables & grounds)', parts: ['battery', 'starter', 'alternator'], tools: ['Multimeter'],
    steps: ['While cranking, measure across battery + to starter stud.', 'Battery − to engine block.', 'At 2000 rpm with loads on: alternator output to battery +.'],
    readings: [{ id: 'pos', label: 'Positive cable', unit: 'V', nominal: 0, limit: 0.5 }, { id: 'neg', label: 'Ground side', unit: 'V', nominal: 0, limit: 0.3 }, { id: 'alt', label: 'Alternator output wire', unit: 'V', nominal: 0, limit: 0.5 }],
    criteria: 'Under 0.5 V positive, under 0.3 V ground.' });
  add({ id: 't_parasitic', group: 'Electrical', name: 'Parasitic draw', parts: ['battery', 'interior'], tools: ['Multimeter (10 A range) or amp clamp'],
    steps: ['Doors closed and latched, key out. Wait 30-45 minutes for modules to sleep.', 'Measure current in series with the negative cable.', 'If high, pull fuses one at a time to find the circuit.'],
    readings: [{ id: 'ma', label: 'Draw', unit: 'mA', nominal: 20, limit: 50 }], criteria: 'Under 50 mA.' });

  // ---- Emissions / OBD ----
  add({ id: 't_obd_scan', group: 'OBD-II', name: 'DTC scan & readiness monitors', parts: ['engine'], tools: ['ELM327 + app'],
    steps: ['Read stored, pending and permanent codes (use the OBD tab).', 'Record each readiness monitor status.'],
    readings: [{ id: 'dtcs', label: 'Codes found', unit: 'count', nominal: 0, limit: 1 }, { id: 'incomplete', label: 'Incomplete monitors', unit: 'count', nominal: 0, limit: 2 }],
    criteria: 'No codes; all monitors complete (most states allow one incomplete for 2001+).' });
  add({ id: 't_fuel_trims', group: 'OBD-II', name: 'Fuel trim analysis', parts: ['maf', 'intake_gasket', 'injectors', 'fuel_pump', 'o2_up_1', 'o2_up_2'], tools: ['ELM327 + app'],
    steps: ['Warm engine. Record STFT + LTFT per bank at idle and 2500 rpm.', 'Lean at idle but fine at 2500 = vacuum leak. Lean everywhere = fuel delivery or MAF.'],
    readings: [{ id: 'b1i', label: 'Bank 1 total trim idle', unit: '%' }, { id: 'b1c', label: 'Bank 1 total trim 2500 rpm', unit: '%' },
      ...(banks > 1 ? [{ id: 'b2i', label: 'Bank 2 total trim idle', unit: '%' }, { id: 'b2c', label: 'Bank 2 total trim 2500 rpm', unit: '%' }] : [])],
    criteria: 'Total trim within ±10%.',
    evaluate: (v) => { const xs = ['b1i', 'b1c', 'b2i', 'b2c'].map((k) => v[k]).filter((x) => x != null && x !== '').map((x) => Math.abs(+x)); if (!xs.length) return []; const w = Math.max(...xs); return [{ status: w > 15 ? 'fail' : w > 10 ? 'watch' : 'pass', text: `Worst total trim ${w}%` }]; } });
  add({ id: 't_o2', group: 'OBD-II', name: 'O2 sensor response', parts: ['o2_up_1', 'o2_up_2', 'o2_down_1', 'o2_down_2', 'cat_1', 'cat_2'], tools: ['ELM327 + app'],
    steps: ['At 2500 rpm, watch upstream sensors cross 0.45 V.', 'Count crossings in 10 s.', 'Downstream should stay fairly steady around 0.6-0.7 V.'],
    readings: [{ id: 'xc', label: 'Upstream crossings in 10 s', unit: 'count', nominal: 10, limit: 3 }],
    criteria: 'Upstream switches several times per second; a downstream that copies the upstream means a weak catalyst.' });
  add({ id: 't_backpressure', group: 'Exhaust', name: 'Exhaust backpressure', parts: ['cat_1', 'cat_2', 'muffler', 'exhaust'], tools: ['Backpressure gauge in upstream O2 port'],
    steps: ['Replace upstream O2 with the gauge adapter.', 'Record at idle and 2500 rpm.'],
    readings: [{ id: 'idle', label: 'Idle', unit: 'psi', nominal: 0.5, limit: 1.5 }, { id: 'rpm', label: '2500 rpm', unit: 'psi', nominal: 1.5, limit: 3 }],
    criteria: 'Under 1.5 psi at idle and under 3 psi at 2500 rpm.' });

  // ---- Brakes ----
  add({ id: 't_brake_measure', group: 'Brakes', name: 'Brake measurement (pads/shoes, rotors/drums)', parts: ['pads_F', 'rotors_F', o.rearBrakes === 'drum' ? 'shoes_R' : 'pads_R', o.rearBrakes === 'drum' ? 'drums_R' : 'rotors_R'],
    tools: ['Brake pad gauge', 'Micrometer', 'Dial indicator', o.rearBrakes === 'drum' ? 'Drum gauge' : 'Micrometer'],
    steps: ['Wheels off. Measure thinnest pad at each front corner.', 'Measure rotor thickness at 4 points; check runout with a dial indicator.', o.rearBrakes === 'drum' ? 'Pull drums: measure lining and drum diameter.' : 'Measure rear pads and rotors.'],
    readings: [
      { id: 'pad_f', label: 'Front pad thickness', unit: 'mm', count: 2, labels: ['FL', 'FR'], nominal: 11, limit: 3, apply: 'pads_F', applyAs: 'min' },
      { id: 'rotor_f', label: 'Front rotor thickness', unit: 'mm', count: 2, labels: ['FL', 'FR'], apply: 'rotors_F', applyAs: 'min' },
      { id: 'runout_f', label: 'Front rotor runout', unit: 'in', count: 2, labels: ['FL', 'FR'], nominal: 0, limit: 0.003 },
      ...(o.rearBrakes === 'drum'
        ? [{ id: 'shoe_r', label: 'Rear shoe lining', unit: 'mm', count: 2, labels: ['RL', 'RR'], nominal: 5, limit: 1.5, apply: 'shoes_R', applyAs: 'min' }, { id: 'drum_r', label: 'Rear drum diameter', unit: 'in', count: 2, labels: ['RL', 'RR'] }]
        : [{ id: 'pad_r', label: 'Rear pad thickness', unit: 'mm', count: 2, labels: ['RL', 'RR'], nominal: 9, limit: 3, apply: 'pads_R', applyAs: 'min' }, { id: 'rotor_r', label: 'Rear rotor thickness', unit: 'mm', count: 2, labels: ['RL', 'RR'], apply: 'rotors_R', applyAs: 'min' }]),
    ],
    criteria: 'Pads above 3 mm; rotors above MIN TH; runout under 0.002-0.003 in.' });
  add({ id: 't_brake_fluid', group: 'Brakes', name: 'Brake fluid boiling point / moisture', parts: ['brake_fluid'], tools: ['Brake fluid tester'],
    steps: ['Test fluid in the master cylinder reservoir.'],
    readings: [{ id: 'water', label: 'Water content', unit: '%', nominal: 0, limit: 3 }], criteria: 'Under 2%; flush at 3% or more.' });
  add({ id: 't_booster', group: 'Brakes', name: 'Brake booster & check valve test', parts: ['brake_master'], tools: [],
    steps: ['Engine off: pump pedal until hard.', 'Hold pedal and start engine: pedal should drop slightly.', 'Run 1 min, shut off, wait 90 s: should still get 2-3 assisted presses.'],
    readings: [], criteria: 'Pedal drops on start and holds reserve. Hissing at the pedal means a leaking diaphragm.' });
  add({ id: 't_brake_bleed', group: 'Brakes', name: 'Brake balance & stopping test', parts: ['pads_F', 'caliper_FL', 'caliper_FR', 'brake_master'], tools: ['Empty lot'],
    steps: ['Stop from 30 mph at moderate pressure, hands light on the wheel.', 'Repeat a firm stop.', 'Check each wheel for even heat with IR thermometer after.'],
    readings: [{ id: 'temps', label: 'Rotor/drum temperature', unit: '°F', count: 4, labels: ['FL', 'FR', 'RL', 'RR'] }],
    criteria: 'No pull; side-to-side temperature within about 50 °F.',
    evaluate: (v) => { const t = (v.temps || []).map(Number); const out = []; if (t[0] && t[1] && Math.abs(t[0] - t[1]) > 50) out.push({ status: 'fail', text: `Front temps differ ${Math.abs(t[0] - t[1])} °F: sticking caliper or slide`, parts: ['caliper_FL', 'caliper_FR'] }); if (t[2] && t[3] && Math.abs(t[2] - t[3]) > 50) out.push({ status: 'watch', text: `Rear temps differ ${Math.abs(t[2] - t[3])} °F` }); return out; } });

  // ---- Chassis ----
  add({ id: 't_suspension_play', group: 'Suspension & steering', name: 'Suspension & steering play (on lift)', parts: ['balljoint_FL', 'balljoint_FR', 'tierod_L', 'tierod_R', 'bearing_FL', 'bearing_FR', 'lca_FL', 'lca_FR'],
    tools: ['Jack & stands or lift', 'Pry bar', 'Dial indicator (optional)'],
    steps: ['Support the control arms so the suspension is loaded where the manual says.', 'Rock each wheel 12-6 o\'clock (bearings, ball joints) and 9-3 o\'clock (tie rods).', 'Pry under each ball joint and measure movement.'],
    readings: [{ id: 'bj', label: 'Ball joint vertical play', unit: 'in', count: 2, labels: ['FL', 'FR'], nominal: 0, limit: 0.03 }],
    criteria: 'No perceptible play in tie rods or bearings. Ball joint play within the service manual limit (often near zero for loaded joints).' });
  add({ id: 't_bounce', group: 'Suspension & steering', name: 'Shock / strut bounce test', parts: ['strut_FL', 'strut_FR', 'shock_FL', 'shock_FR', 'shock_RL', 'shock_RR'], tools: [],
    steps: ['Push each corner down hard and release.'],
    readings: [{ id: 'cycles', label: 'Rebound cycles', unit: 'count', count: 4, labels: ['FL', 'FR', 'RL', 'RR'], nominal: 1, limit: 3 }],
    criteria: 'Settles in about 1 cycle.' });
  add({ id: 't_ride_height', group: 'Suspension & steering', name: 'Ride height', parts: ['spring_FL', 'spring_FR', 'spring_RL', 'spring_RR'], tools: ['Tape measure'],
    steps: ['Level ground, correct tire pressures. Measure center of hub to fender lip at each corner.'],
    readings: [{ id: 'h', label: 'Hub to fender', unit: 'in', count: 4, labels: ['FL', 'FR', 'RL', 'RR'] }],
    criteria: 'Left and right within 1/2 in of each other.',
    evaluate: (v) => { const h = (v.h || []).map(Number); const out = []; if (h[0] && h[1] && Math.abs(h[0] - h[1]) > 0.5) out.push({ status: 'watch', text: `Front sides differ ${Math.abs(h[0] - h[1]).toFixed(2)} in`, parts: ['spring_FL', 'spring_FR'] }); if (h[2] && h[3] && Math.abs(h[2] - h[3]) > 0.5) out.push({ status: 'watch', text: `Rear sides differ ${Math.abs(h[2] - h[3]).toFixed(2)} in`, parts: ['spring_RL', 'spring_RR'] }); return out; } });
  add({ id: 't_alignment', group: 'Suspension & steering', name: 'Alignment check (string or shop printout)', parts: ['alignment'], tools: ['Alignment printout or toe plates'],
    steps: ['Record camber, caster, toe per side from the shop printout or your own setup.'],
    readings: [{ id: 'toe', label: 'Total toe', unit: 'in' }, { id: 'camber', label: 'Camber L / R', unit: '°', count: 2, labels: ['L', 'R'] }, { id: 'caster', label: 'Caster L / R', unit: '°', count: 2, labels: ['L', 'R'] }],
    criteria: 'Within the factory alignment spec; camber side-to-side within 0.5°.' });
  add({ id: 't_tires', group: 'Tires & wheels', name: 'Tire measurement (tread & pressure)', parts: ['tire_FL', 'tire_FR', 'tire_RL', 'tire_RR'], tools: ['Tread depth gauge', 'Pressure gauge'],
    steps: ['Measure tread at inner, center and outer grooves; record the lowest.', 'Measure cold pressure.'],
    readings: [
      ...['FL', 'FR', 'RL', 'RR'].map((k) => ({ id: `tread_${k}`, label: `Tread ${k}`, unit: '/32"', nominal: 10, limit: 2, apply: `tire_${k}` })),
      { id: 'psi', label: 'Cold pressure', unit: 'psi', count: 4, labels: ['FL', 'FR', 'RL', 'RR'] },
    ],
    criteria: 'Tread above 2/32" (4/32" recommended for wet roads).' });

  // ---- Drivetrain ----
  if (manual) add({ id: 't_clutch', group: 'Drivetrain', name: 'Clutch slip & engagement test', parts: ['clutch', 'clutch_cable'], tools: [],
    steps: ['Warm car. In 4th at about 2000 rpm, floor the throttle: rpm must not rise faster than road speed.', 'Note pedal height where engagement starts.'],
    readings: [{ id: 'engage', label: 'Engagement point from floor', unit: 'in' }],
    criteria: 'No slip. Engagement roughly mid-travel; very high engagement = worn disc (or a cable that needs adjusting).' });
  if (rwdLike) add({ id: 't_driveline', group: 'Drivetrain', name: 'Driveline play & noise', parts: ['driveshaft', 'rear_diff', 'transmission'], tools: ['Dial indicator (optional)'],
    steps: ['In neutral, twist the driveshaft by hand; note slack at the U-joints and pinion.', 'Check driveshaft runout if there is a vibration.'],
    readings: [{ id: 'runout', label: 'Driveshaft runout', unit: 'in', nominal: 0, limit: 0.035 }],
    criteria: 'No play in U-joints. Runout under spec (often around 0.035 in).' });
  if (rwdLike) add({ id: 't_diff_oil', group: 'Drivetrain', name: 'Gear oil condition (drain & magnet)', parts: ['rear_diff', 'rear_diff_fluid', 'transmission'], tools: ['Drain pan'],
    steps: ['When changing, look at the oil and magnet. Fine paste is normal; chunks or chips are not.'],
    readings: [], criteria: 'No chunks; no milky (water) oil.' });

  // ---- HVAC ----
  add({ id: 't_ac', group: 'HVAC', name: 'A/C performance', parts: ['ac_system', 'fan'], tools: ['Vent thermometer', 'A/C manifold gauges (optional)'],
    steps: ['Max A/C, recirc, blower high, 1500 rpm, doors closed 5 min.', 'Record center vent temperature, ambient and (if gauges) low/high side pressures.'],
    readings: [{ id: 'vent', label: 'Center vent temp', unit: '°F', nominal: 40, limit: 55 }, { id: 'amb', label: 'Ambient temp', unit: '°F' }, { id: 'lo', label: 'Low side', unit: 'psi' }, { id: 'hi', label: 'High side', unit: 'psi' }],
    criteria: 'Vent 35-45 °F on a mild day. Pressures per the ambient chart.' });

  return T;
}

// Turns a finished checklist/test into a list of per-part results, the
// measurements to save and an overall status for each item/test.
// run.results: { itemId: { status, value, note } }
// run.tests:   { testId: { values: { readingId: value | [values] }, status?, note } }
export function summarizeRun(run, items, tests) {
  const findings = []; // { key, status, text, parts, crit }
  const measures = []; // { part, value, label }
  const itemById = new Map(items.map((x) => [x.id, x]));
  for (const [id, r] of Object.entries(run.results || {})) {
    const it = itemById.get(id);
    if (!it || !r) continue;
    let status = r.status;
    if (!status && it.m && r.value != null && r.value !== '') status = measureStatus(it.m, r.value);
    if (!status || status === 'na') continue;
    findings.push({ key: `insp:${id}`, status, text: `${it.text}${r.value != null && r.value !== '' ? ` (${r.value}${it.m?.unit ? ` ${it.m.unit}` : ''})` : ''}${r.note ? ` · ${r.note}` : ''}`, parts: it.parts, crit: !!it.crit });
    if (it.m?.apply && r.value != null && r.value !== '') measures.push({ part: it.m.apply, value: +r.value, label: it.m.label });
  }
  const testById = new Map(tests.map((t) => [t.id, t]));
  for (const [id, tr] of Object.entries(run.tests || {})) {
    const t = testById.get(id);
    if (!t || !tr) continue;
    const ev = evaluateTest(t, tr.values || {});
    const status = tr.status || ev.status;
    if (!status || status === 'na') continue;
    const bad = ev.notes.filter((n) => n.status !== 'pass').map((n) => n.text);
    findings.push({ key: `test:${id}`, status, text: `${t.name}${bad.length ? `: ${bad.join('; ')}` : ''}${tr.note ? ` · ${tr.note}` : ''}`, parts: t.parts, crit: false });
    ev.notes.forEach((n, i) => { if (n.parts && n.status !== 'pass') findings.push({ key: `test:${id}:r${i}`, status: n.status, text: `${t.name}: ${n.text}`, parts: n.parts }); });
    for (const m of ev.measures) measures.push(m);
  }
  return { findings, measures };
}

const RANK = { pass: 0, watch: 1, fail: 2 };
export const worse = (a, b) => (RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a;

// Evaluates a test from its readings: limits on each value plus the test's
// own rules. Returns { status, notes:[{status,text,parts?}], measures }.
export function evaluateTest(t, values) {
  const notes = [];
  const measures = [];
  let status = null;
  for (const r of t.readings) {
    const v = values[r.id];
    const list = Array.isArray(v) ? v : [v];
    const nums = list.map((x) => (x === '' || x == null || Number.isNaN(+x) ? null : +x));
    if (!nums.some((x) => x != null)) continue;
    const st = nums.map((x) => (x == null ? null : measureStatus(r, x)));
    for (let i = 0; i < nums.length; i++) {
      if (!st[i]) continue;
      status = worse(status, st[i]);
      if (st[i] !== 'pass') notes.push({ status: st[i], text: `${r.label}${r.labels ? ` ${r.labels[i]}` : ''} ${nums[i]} ${r.unit}` });
    }
    if (!st.some(Boolean)) status = worse(status, 'pass');
    if (r.apply) {
      const valid = nums.filter((x) => x != null);
      // Worst value goes to the part's measurement history.
      const pick = r.nominal != null && r.limit != null && r.limit > r.nominal ? Math.max(...valid) : Math.min(...valid);
      measures.push({ part: r.apply, value: pick, label: r.label });
    }
  }
  if (t.evaluate) {
    for (const n of t.evaluate(values) || []) {
      notes.push(n);
      status = worse(status, n.status);
    }
  }
  return { status, notes, measures };
}
