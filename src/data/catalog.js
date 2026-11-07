// Parts catalog: everything you can buy or make for a vehicle, mapped to the
// app's part keys so a catalog line shows up on the part it serves.
//
// The generic catalog is built from vehicle options (like buildPartList), so
// every vehicle gets a full shopping list with no part numbers. A vehicle
// catalog (see ./catalogs) adds specs, capacities and part numbers on top.
//
// Item fields:
//   id        unique key (stable across versions; user edits are keyed by it)
//   name      display name
//   cat       fluid | filter | gasket | seal | part | wear | sensor | hardware | fab
//   parts     part keys this item belongs to
//   qty       how many per job
//   spec      spec / grade / type
//   capacity  fill amount (fluids)
//   pns       [{ brand, pn, verified, source }] — verified=false means "check before buying"
//   fab       how to fabricate it (cat 'fab' or anything also fabricable)
//   safety    true when it is safety-critical (shown as a warning on fab items)
//   note      free text

export const CATEGORIES = {
  fluid: 'Fluids & lubricants',
  filter: 'Filters',
  gasket: 'Gaskets',
  seal: 'Seals & O-rings',
  wear: 'Wear items',
  part: 'Replacement parts',
  sensor: 'Sensors & electrical',
  hardware: 'Hardware & small parts',
  fab: 'Fabricate or make',
};

export function buildCatalog(o) {
  const C = [];
  const add = (x) => C.push({ qty: 1, pns: [], ...x });
  const v = o.layout === 'V';
  const manual = o.trans === 'manual';
  const rwdLike = o.drivetrain === 'rwd' || o.drivetrain === '4wd' || o.drivetrain === 'awd';
  const fwdLike = o.drivetrain === 'fwd' || o.drivetrain === 'awd';
  const cyl = o.cylinders || 4;
  const banks = v ? 2 : 1;

  // ---------- Fluids & lubricants ----------
  add({ id: 'f_oil', cat: 'fluid', name: 'Engine oil', parts: ['oil'] });
  add({ id: 'f_coolant', cat: 'fluid', name: 'Engine coolant (50/50 mix)', parts: ['coolant'], note: 'Do not mix coolant chemistries. Use distilled water for concentrate.' });
  add({ id: 'f_brake', cat: 'fluid', name: 'Brake fluid', parts: ['brake_fluid'] });
  add({ id: 'f_ps', cat: 'fluid', name: 'Power steering fluid', parts: ['ps_fluid'] });
  add({ id: 'f_trans', cat: 'fluid', name: manual ? 'Manual transmission fluid' : 'Automatic transmission fluid', parts: ['trans_fluid'] });
  if (rwdLike) add({ id: 'f_rear_diff', cat: 'fluid', name: 'Rear axle gear oil', parts: ['rear_diff_fluid'] });
  if (rwdLike) add({ id: 'f_friction_mod', cat: 'fluid', name: 'Limited-slip friction modifier', parts: ['rear_diff_fluid'], note: 'Only for limited-slip axles.' });
  if (o.drivetrain === '4wd' || o.drivetrain === 'awd') add({ id: 'f_transfer', cat: 'fluid', name: 'Transfer case / PTU fluid', parts: ['transfer_fluid'] });
  if (o.drivetrain === '4wd') add({ id: 'f_front_diff', cat: 'fluid', name: 'Front axle gear oil', parts: ['front_diff_fluid'] });
  if (manual && o.clutchHydraulic) add({ id: 'f_clutch', cat: 'fluid', name: 'Clutch hydraulic fluid', parts: ['clutch_cable'], note: 'Usually shares the brake fluid spec.' });
  add({ id: 'f_ac', cat: 'fluid', name: 'A/C refrigerant & compressor oil', parts: ['ac_system'], spec: 'Check the under-hood A/C label (R-134a for most 1994-2014 cars)' });
  add({ id: 'f_washer', cat: 'fluid', name: 'Washer fluid', parts: ['washer'] });
  add({ id: 'f_fuel', cat: 'fluid', name: 'Fuel', parts: ['fuel_tank'] });
  add({ id: 'f_grease_chassis', cat: 'fluid', name: 'Chassis grease (NLGI #2)', parts: ['driveshaft', 'balljoint_FL', 'balljoint_FR', 'tierod_L', 'tierod_R'] });
  add({ id: 'f_grease_wb', cat: 'fluid', name: 'Wheel bearing grease (high temp)', parts: ['bearing_FL', 'bearing_FR'], note: 'Only for serviceable tapered bearings.' });
  add({ id: 'f_brake_grease', cat: 'fluid', name: 'Silicone brake caliper grease', parts: ['pads_F', 'pads_R', 'shoes_R'] });
  add({ id: 'f_dielectric', cat: 'fluid', name: 'Dielectric grease', parts: ['plugs', 'coils', 'plug_wires', 'headlights', 'taillights'] });
  add({ id: 'f_antiseize', cat: 'fluid', name: 'Anti-seize (nickel or copper)', parts: ['plugs', 'o2_up_1', 'o2_down_1', 'exhaust'] });
  add({ id: 'f_threadlock', cat: 'fluid', name: 'Threadlocker (blue/red)', parts: ['calipers', 'caliper_FL', 'caliper_FR'] });
  add({ id: 'f_rtv', cat: 'fluid', name: 'RTV silicone (oil and water resistant)', parts: ['oil_pan_gasket', 'front_cover', 'intake_gasket', 'water_pump', 'rear_diff'] });
  add({ id: 'f_assembly_lube', cat: 'fluid', name: 'Engine assembly lube', parts: ['engine'] });
  add({ id: 'f_pb', cat: 'fluid', name: 'Penetrating oil, brake cleaner, throttle body & MAF cleaner', parts: ['throttle_body', 'maf'] });
  add({ id: 'f_lock', cat: 'fluid', name: 'Lock lubricant and weatherstrip silicone', parts: ['body'] });

  // ---------- Filters ----------
  add({ id: 'flt_oil', cat: 'filter', name: 'Oil filter', parts: ['oil'] });
  add({ id: 'flt_air', cat: 'filter', name: 'Engine air filter', parts: ['air_filter'] });
  add({ id: 'flt_fuel', cat: 'filter', name: 'Fuel filter', parts: ['fuel_filter'] });
  if (o.cabinFilter) add({ id: 'flt_cabin', cat: 'filter', name: 'Cabin air filter', parts: ['cabin_filter'] });
  if (!manual) add({ id: 'flt_trans', cat: 'filter', name: 'Transmission filter & pan gasket', parts: ['trans_fluid'] });
  add({ id: 'flt_pcv', cat: 'filter', name: 'PCV valve & grommet', parts: ['pcv'] });
  add({ id: 'flt_ac_drier', cat: 'filter', name: 'A/C accumulator / receiver-drier', parts: ['ac_system'], note: 'Replace whenever the A/C system is opened.' });

  // ---------- Gaskets ----------
  const G = (id, name, parts, extra = {}) => add({ id, cat: 'gasket', name, parts, ...extra });
  G('g_head', `Head gasket${banks > 1 ? 's (2)' : ''}`, ['head_gaskets'], { qty: banks, note: 'Usually bought as a head set with valve stem seals, intake and exhaust gaskets. Check whether head bolts are torque-to-yield (single use).' });
  G('g_head_bolts', 'Head bolts (if torque-to-yield)', ['head_gaskets'], { cat: 'hardware' });
  G('g_intake_upper', 'Upper intake / plenum gasket', ['intake_gasket']);
  G('g_intake_lower', 'Lower intake manifold gaskets', ['intake_gasket']);
  G('g_tb', 'Throttle body gasket', ['throttle_body']);
  G('g_valve_cover', `Valve cover gasket${banks > 1 ? 's' : ''}`, ['valve_cover_gaskets'], { qty: banks });
  G('g_oil_pan', 'Oil pan gasket', ['oil_pan_gasket']);
  G('g_timing_cover', 'Timing cover gasket set', ['front_cover', 'timing']);
  G('g_water_pump', 'Water pump gasket', ['water_pump']);
  G('g_thermostat', 'Thermostat housing gasket / O-ring', ['thermostat'], { fab: 'Paper gaskets can be cut from coolant-rated gasket sheet if the original was paper.' });
  G('g_exhaust_man', `Exhaust manifold gaskets${banks > 1 ? ' (2)' : ''}`, ['exhaust'], { qty: banks });
  G('g_exhaust_flange', 'Exhaust pipe flange gaskets / donuts', ['exhaust', `cat_1`]);
  if (o.egr) G('g_egr', 'EGR valve and EGR tube gaskets', ['egr']);
  if (rwdLike) G('g_diff_cover', 'Differential cover gasket', ['rear_diff', 'rear_diff_fluid'], { fab: 'A bead of RTV is a common substitute on most cover designs.' });
  if (!manual) G('g_trans_pan', 'Transmission pan gasket', ['trans_fluid']);
  G('g_fuel_pump', 'Fuel pump / sender lock ring gasket', ['fuel_pump', 'fuel_tank']);
  G('g_iac', 'Idle air control valve gasket', ['throttle_body']);
  G('g_oil_drain', 'Oil drain plug gasket / washer', ['oil'], { cat: 'hardware', note: 'Replace every oil change if the plug uses a crush washer.' });

  // ---------- Seals & O-rings ----------
  const S = (id, name, parts, extra = {}) => add({ id, cat: 'seal', name, parts, ...extra });
  S('s_rear_main', 'Rear main seal', ['rear_main_seal']);
  S('s_front_crank', 'Front crankshaft seal', ['front_cover']);
  S('s_valve_stem', 'Valve stem seals', ['head_gaskets'], { qty: cyl * 2 });
  S('s_injector', 'Fuel injector O-rings & seals', ['injectors'], { qty: cyl });
  S('s_dipstick', 'Dipstick tube and oil filler cap seals', ['oil']);
  S('s_trans_input', manual ? 'Transmission input shaft seal' : 'Torque converter / front pump seal', ['transmission']);
  if (rwdLike) S('s_trans_output', 'Transmission output / extension housing seal', ['transmission', 'driveshaft']);
  if (manual) S('s_shifter', 'Shifter seal / boot', ['transmission']);
  if (rwdLike) S('s_pinion', 'Differential pinion seal', ['rear_diff']);
  if (o.rearSuspension === 'solid' && rwdLike) S('s_axle', 'Rear axle seals', ['axle_seals'], { qty: 2 });
  if (fwdLike) S('s_axle_front', 'Transaxle / CV axle seals', ['transmission'], { qty: 2 });
  S('s_ps', 'Power steering pump & line O-rings', ['ps_pump', 'steering_rack']);
  S('s_ac', 'A/C line O-ring kit (HNBR)', ['ac_system']);
  S('s_cam_plug', 'Camshaft plug / cam sensor O-ring', ['cam_sensor']);
  S('s_hub', 'Wheel hub grease seals', ['bearing_FL', 'bearing_FR']);

  // ---------- Wear items ----------
  const W = (id, name, parts, extra = {}) => add({ id, cat: 'wear', name, parts, ...extra });
  W('w_plugs', `Spark plugs (${cyl})`, ['plugs'], { qty: cyl });
  if (o.plugWires) W('w_wires', 'Spark plug wire set', ['plug_wires']);
  W('w_belt', 'Serpentine / accessory belt', ['belt']);
  if (o.timing === 'belt') W('w_timing_belt', 'Timing belt kit (belt, tensioner, idlers)', ['timing']);
  W('w_pads_f', 'Front brake pads', ['pads_F']);
  if (o.rearBrakes === 'drum') W('w_shoes_r', 'Rear brake shoes', ['shoes_R']);
  else W('w_pads_r', 'Rear brake pads', ['pads_R']);
  W('w_rotors_f', 'Front rotors (pair)', ['rotors_F'], { qty: 2 });
  if (o.rearBrakes === 'drum') {
    W('w_drums_r', 'Rear brake drums (pair)', ['drums_R'], { qty: 2 });
    W('w_wheel_cyl', 'Rear wheel cylinders', ['drums_R'], { qty: 2, cat: 'part' });
    W('w_drum_hw', 'Drum brake hardware kit (springs, adjusters)', ['drums_R', 'shoes_R'], { cat: 'hardware' });
  } else W('w_rotors_r', 'Rear rotors (pair)', ['rotors_R'], { qty: 2 });
  W('w_pad_hw', 'Brake pad hardware / abutment clips', ['pads_F'], { cat: 'hardware' });
  W('w_wipers', 'Wiper blades (driver + passenger)', ['wipers'], { qty: 2 });
  W('w_tires', 'Tires', ['tire_FL', 'tire_FR', 'tire_RL', 'tire_RR'], { qty: 4 });
  W('w_valve_stems', 'Tire valve stems / TPMS service kits', ['tire_FL', 'tire_FR', 'tire_RL', 'tire_RR'], { qty: 4, cat: 'hardware' });
  if (manual) W('w_clutch_kit', 'Clutch kit (disc, pressure plate, throwout bearing, pilot bearing)', ['clutch']);
  if (manual) W('w_flywheel', 'Flywheel (resurface or replace)', ['clutch'], { cat: 'part' });
  W('w_bulbs', 'Bulbs (headlight, park/turn, brake/tail, reverse, plate, interior)', ['headlights', 'taillights', 'interior']);

  // ---------- Replacement parts ----------
  const P = (id, name, parts, extra = {}) => add({ id, cat: 'part', name, parts, ...extra });
  P('p_thermostat', 'Thermostat', ['thermostat']);
  P('p_water_pump', 'Water pump', ['water_pump']);
  P('p_radiator', 'Radiator', ['radiator']);
  P('p_rad_cap', 'Radiator / reservoir pressure cap', ['rad_cap']);
  P('p_hoses', 'Upper & lower radiator hoses', ['hoses'], { fab: 'Universal flex hose only as a temporary repair.' });
  P('p_heater_hoses', 'Heater hoses & bypass hose', ['hoses', 'heater_core'], { fab: 'Bulk heater hose of the right ID with new clamps.' });
  P('p_fan', 'Cooling fan & module / clutch', ['fan']);
  P('p_reservoir', 'Coolant reservoir / degas bottle', ['coolant']);
  P('p_heater_core', 'Heater core', ['heater_core']);
  P('p_tensioner', 'Belt tensioner', ['tensioner']);
  P('p_idler', 'Idler pulley', ['tensioner']);
  P('p_timing_set', o.timing === 'belt' ? 'Timing belt, tensioner & cam/crank seals' : 'Timing chain set (chain, gears, guides, tensioner)', ['timing']);
  P('p_oil_pump', 'Oil pump & pickup', ['engine']);
  P('p_motor_mounts', 'Engine mounts', ['engine_mount_L', 'engine_mount_R'], { qty: 2 });
  P('p_trans_mount', 'Transmission mount', ['trans_mount']);
  P('p_coil', o.plugWires ? 'Ignition coil pack' : 'Ignition coils', ['coils'], { qty: o.plugWires ? 1 : cyl });
  P('p_fuel_pump', 'Fuel pump (module or pump + strainer)', ['fuel_pump']);
  P('p_injectors', `Fuel injectors (${cyl})`, ['injectors'], { qty: cyl });
  P('p_fpr', 'Fuel pressure regulator', ['fuel_pump', 'injectors']);
  P('p_gas_cap', 'Gas cap', ['evap']);
  P('p_evap_valves', 'EVAP purge & vent valves, canister', ['evap']);
  P('p_iac', 'Idle air control valve', ['throttle_body']);
  P('p_tb', 'Throttle body', ['throttle_body']);
  P('p_intake_tube', 'Air intake tube & resonator', ['air_filter', 'maf'], { fab: 'Can be replaced with a fabricated tube (aluminum or silicone couplers). The MAF must keep its calibrated housing diameter.' });
  P('p_battery', 'Battery', ['battery']);
  P('p_battery_cables', 'Battery cables & terminals', ['battery', 'starter'], { fab: 'Make cables from welding cable (2 AWG or larger) with crimped and soldered lugs and heat-shrink.' });
  P('p_alternator', 'Alternator', ['alternator']);
  P('p_starter', 'Starter', ['starter']);
  if (manual) P('p_clutch_cable', o.clutchHydraulic ? 'Clutch master & slave cylinder' : 'Clutch cable, quadrant & firewall adjuster', ['clutch_cable']);
  if (manual) P('p_shifter', 'Shifter bushings / shifter', ['transmission']);
  if (rwdLike) P('p_ujoints', 'U-joints', ['driveshaft'], { qty: 2 });
  if (rwdLike) P('p_center_bearing', 'Driveshaft center support bearing (two-piece shafts only)', ['driveshaft']);
  if (o.rearSuspension === 'solid' && rwdLike) {
    P('p_axle_bearings', 'Rear axle bearings', ['axle_seals'], { qty: 2 });
    P('p_axle_shafts', 'Rear axle shafts', ['axle_seals'], { qty: 2 });
    P('p_diff_bearings', 'Differential carrier & pinion bearings, gears, clutches', ['rear_diff']);
  }
  for (const s of ['L', 'R']) {
    if (fwdLike || o.drivetrain === '4wd') P(`p_front_cv_${s}`, `Front CV axle ${s === 'L' ? 'left' : 'right'}`, [`front_cv_${s}`]);
    if (rwdLike && o.rearSuspension !== 'solid') P(`p_rear_cv_${s}`, `Rear CV axle ${s === 'L' ? 'left' : 'right'}`, [`rear_cv_${s}`]);
  }
  P('p_master_cyl', 'Brake master cylinder', ['brake_master']);
  P('p_booster', 'Brake booster & check valve', ['brake_master']);
  P('p_calipers', 'Brake calipers', ['caliper_FL', 'caliper_FR', 'caliper_RL', 'caliper_RR']);
  P('p_brake_hoses', 'Brake hoses (flex lines)', ['brake_lines'], { qty: 3 });
  P('p_brake_lines', 'Hard brake lines', ['brake_lines'], { fab: 'Bend from bulk copper-nickel line (usually 3/16 in) with the correct flare (double or ISO bubble). Use the original fittings.', safety: true });
  P('p_pb_cables', 'Parking brake cables', ['parking_brake']);
  P('p_hubs', 'Front wheel bearings / hub assemblies', ['bearing_FL', 'bearing_FR'], { qty: 2 });
  P('p_lugs', 'Wheel studs & lug nuts', ['bearing_FL', 'bearing_FR', 'bearing_RL', 'bearing_RR'], { cat: 'hardware' });
  if (o.frontSuspension === 'strut') {
    P('p_struts', 'Front struts', ['strut_FL', 'strut_FR'], { qty: 2 });
    P('p_strut_mounts', 'Strut mounts & bearings', ['strut_mount_FL', 'strut_mount_FR'], { qty: 2 });
  } else P('p_shocks_f', 'Front shocks', ['shock_FL', 'shock_FR'], { qty: 2 });
  P('p_shocks_r', 'Rear shocks', ['shock_RL', 'shock_RR'], { qty: 2 });
  P('p_springs', 'Springs (front & rear) and isolators', ['spring_FL', 'spring_FR', 'spring_RL', 'spring_RR'], { qty: 4 });
  P('p_lca', 'Front lower control arms (with bushings)', ['lca_FL', 'lca_FR'], { qty: 2 });
  P('p_balljoints', 'Lower ball joints', ['balljoint_FL', 'balljoint_FR'], { qty: 2, note: 'Often only sold with the control arm.' });
  if (o.frontSuspension === 'wishbone') P('p_uca', 'Upper control arms', ['uca_FL', 'uca_FR'], { qty: 2 });
  if (o.rearSuspension === 'solid') {
    P('p_rear_lca', 'Rear lower control arms', ['rear_lca_RL', 'rear_lca_RR'], { qty: 2 });
    P('p_rear_uca', 'Rear upper control arms & bushings (incl. axle-side bushings)', ['rear_uca_RL', 'rear_uca_RR'], { qty: 2 });
  } else if (o.rearSuspension === 'independent') P('p_rear_arms', 'Rear control arms & bushings', ['rear_arms_RL', 'rear_arms_RR']);
  P('p_sway_links', 'Sway bar end links', ['sway_F', 'sway_R'], { qty: 4 });
  P('p_sway_bushings', 'Sway bar bushings', ['sway_F', 'sway_R'], { qty: 4 });
  P('p_tierods', 'Inner & outer tie rod ends', ['tierod_L', 'tierod_R'], { qty: 4 });
  P('p_rack', o.steering === 'box' ? 'Steering gearbox' : 'Steering rack & boots', ['steering_rack']);
  P('p_ps_pump', 'Power steering pump', ['ps_pump']);
  P('p_ps_hoses', 'Power steering pressure & return hoses', ['ps_pump', 'steering_rack'], { fab: 'Return (low-pressure) hose can be made from bulk PS return hose. Pressure hoses must be bought or made by a hydraulic shop.' });
  P('p_ac_compressor', 'A/C compressor & clutch', ['ac_system']);
  P('p_condenser', 'A/C condenser', ['ac_system']);
  P('p_mufflers', o.dualExhaust ? 'Mufflers (pair)' : 'Muffler', ['muffler']);
  P('p_exhaust_hangers', 'Exhaust hangers & isolators', ['exhaust'], { cat: 'hardware', fab: 'Hangers can be bent from 3/8 in steel rod; use rubber isolators.' });
  P('p_cats', `Catalytic converter${banks > 1 ? 's' : ''}`, ['cat_1', 'cat_2']);
  P('p_wiper_motor', 'Wiper motor & linkage', ['wipers']);
  P('p_washer_pump', 'Washer pump', ['washer']);
  P('p_headlamps', 'Headlamp assemblies', ['headlights']);
  P('p_taillamps', 'Tail lamp assemblies', ['taillights']);
  P('p_blower', 'Blower motor & resistor', ['interior']);
  P('p_weatherstrip', 'Door & window weatherstrips', ['body']);
  P('p_window_reg', 'Window regulators & motors', ['body']);
  P('p_door_hw', 'Door hinge pins & bushings, check straps, latches', ['body']);
  P('p_seatbelts', 'Seat belts & buckles', ['restraints']);

  // ---------- Sensors & electrical ----------
  const E = (id, name, parts, extra = {}) => add({ id, cat: 'sensor', name, parts, ...extra });
  E('e_o2_up', `Upstream O2 sensor${banks > 1 ? 's (2)' : ''}`, ['o2_up_1', 'o2_up_2'], { qty: banks });
  E('e_o2_down', `Downstream O2 sensor${banks > 1 ? 's (2)' : ''}`, ['o2_down_1', 'o2_down_2'], { qty: banks });
  E('e_maf', 'Mass air flow (MAF) sensor', ['maf']);
  E('e_iat', 'Intake air temperature sensor', ['maf']);
  E('e_tps', 'Throttle position sensor', ['throttle_body']);
  E('e_ect', 'Engine coolant temperature sensor & gauge sender', ['thermostat']);
  E('e_cmp', 'Camshaft position sensor', ['cam_sensor']);
  E('e_ckp', 'Crankshaft position sensor', ['crank_sensor']);
  E('e_knock', 'Knock sensor', ['engine']);
  E('e_oil_psi', 'Oil pressure switch / sender', ['oil']);
  E('e_vss', 'Vehicle speed sensor', ['transmission']);
  if (o.egr) E('e_dpfe', 'EGR pressure feedback sensor & hoses', ['egr']);
  if (o.egr) E('e_egr', 'EGR valve & vacuum regulator', ['egr']);
  E('e_fuel_sender', 'Fuel level sender', ['fuel_tank']);
  E('e_fuel_relay', 'Fuel pump relay & inertia switch', ['fuel_pump']);
  E('e_relays', 'Relays & fuses (spares)', ['battery', 'interior']);
  E('e_abs', 'ABS wheel speed sensors (if equipped)', ['bearing_FL', 'bearing_FR']);
  E('e_brake_switch', 'Brake light switch', ['taillights']);
  E('e_reverse', 'Reverse light switch', ['transmission', 'taillights']);
  if (manual) E('e_clutch_switch', 'Clutch pedal position switch', ['clutch_cable']);
  E('e_ign_switch', 'Ignition switch & lock cylinder', ['interior']);
  E('e_horn', 'Horn', ['washer']);

  // ---------- Hardware & small parts ----------
  const H = (id, name, parts, extra = {}) => add({ id, cat: 'hardware', name, parts, ...extra });
  H('h_vac_hose', 'Vacuum hose (bulk 3/32, 5/32, 7/32 in) and caps', ['intake_gasket', 'pcv', 'brake_master', 'egr'], { fab: 'Cut to length from bulk.' });
  H('h_clamps', 'Hose clamps (worm and spring)', ['hoses', 'heater_core']);
  H('h_fuel_clips', 'Fuel line quick-connect clips / spring locks', ['fuel_filter']);
  H('h_exhaust_bolts', 'Exhaust manifold studs, bolts & nuts', ['exhaust']);
  H('h_caliper_bolts', 'Caliper guide pins, boots & bolts', ['caliper_FL', 'caliper_FR']);
  H('h_cotter', 'Cotter pins, castle nuts, axle nuts', ['tierod_L', 'tierod_R', 'balljoint_FL', 'balljoint_FR']);
  H('h_body_clips', 'Body, trim and splash shield clips & push pins', ['body']);
  H('h_connectors', 'Electrical connectors, terminals, pigtails', ['interior', 'battery']);

  // ---------- Fabricate or make ----------
  const F = (id, name, parts, fab, extra = {}) => add({ id, cat: 'fab', name, parts, fab, ...extra });
  F('fab_gaskets', 'Paper / cork gaskets (flat flanges)', ['thermostat', 'water_pump', 'egr', 'rear_diff'], 'Trace the flange on gasket sheet (fiber for coolant/oil, high-temp for exhaust), cut with a hobby knife and punch bolt holes. Never for head, intake or exhaust manifold gaskets.');
  F('fab_brake_lines', 'Hard brake lines', ['brake_lines'], 'Copper-nickel tubing, tubing bender, proper flaring tool. Pressure-test and bleed. Inspect every flare for cracks.', { safety: true });
  F('fab_vac_lines', 'Vacuum lines & hoses', ['intake_gasket', 'pcv', 'brake_master'], 'Bulk vacuum hose, routed per the under-hood vacuum diagram.');
  F('fab_battery_cables', 'Battery & ground cables / ground straps', ['battery', 'starter', 'alternator'], 'Welding cable, copper lugs, hydraulic crimper, adhesive heat-shrink. Add an extra engine-to-body ground strap if voltage drop testing fails.');
  F('fab_wiring', 'Wiring repairs, pigtails, gauge harnesses', ['interior', 'headlights', 'taillights'], 'Match wire gauge, solder and heat-shrink, or use sealed crimp splices. Add fuses for new circuits.');
  F('fab_exhaust', 'Exhaust pipes, hangers, heat shields, tips', ['exhaust', 'muffler'], 'Aluminized or stainless tube, mandrel bends, MIG weld or band clamps. Keep O2 sensor bungs in place and keep heat away from fuel and brake lines.');
  F('fab_intake', 'Cold air intake tube & heat shield', ['air_filter', 'maf'], 'Aluminum tube or silicone couplers. Keep the MAF in its original housing so the calibration stays right.');
  F('fab_brackets', 'Brackets, battery hold-down, mounts for accessories', ['battery', 'body'], 'Steel flat bar or angle, drilled and painted. Battery must not move under hard braking.');
  F('fab_skid', 'Splash shields, skid plate, undertray', ['engine', 'body'], 'Aluminum or ABS sheet with original mounting points.');
  F('fab_brace', 'Strut tower brace / chassis braces', ['strut_mount_FL', 'strut_mount_FR', 'chassis'], 'Steel or aluminum tube with plates on the strut studs. Check hood and engine clearance.');
  F('fab_subframe', 'Subframe connectors', ['chassis'], 'Square tube welded or bolted between front and rear frame rails on unibody cars.', { safety: true });
  F('fab_shims', 'Shims, spacers, washers', ['body', 'mounts'], 'Cut from steel or aluminum stock.');
  F('fab_cable_adjust', 'Clutch / throttle cable adjusters and brackets', ['clutch_cable', 'throttle_body'], 'Billet aluminum or steel; check full pedal travel after install.');
  F('fab_catch_can', 'Oil catch can for PCV', ['pcv'], 'Baffled can in line between PCV and intake. Keep the PCV valve.');
  F('fab_trim', 'Interior trim, shift boot, seat repairs, headliner', ['interior', 'body'], 'Upholstery fabric/vinyl, contact adhesive, sewing.');
  F('fab_bushings', 'Polyurethane bushings or sleeves', ['sway_F', 'sway_R'], 'Machined from urethane rod. Only for low-load mounts (sway bar, shifter). Suspension pivots should use bought parts.');
  F('fab_seals_repair', 'Seal savers / repair sleeves', ['front_cover', 'rear_diff'], 'Use a speedi-sleeve over a grooved shaft instead of replacing the shaft.');
  F('fab_tools', 'Special tools: pressure tester adapters, bleed bottles, pullers', ['brake_fluid', 'coolant'], 'Cap adapters, one-man bleed bottle, spare cap drilled for a gauge, puller plates.');

  return C;
}

// Merge the generic catalog with a vehicle catalog and the user's own edits.
// vc = { items: { id: patch }, extra: [items] }, user = { id: patch }
export function mergeCatalog(generic, vc, user) {
  const map = new Map(generic.map((x) => [x.id, { ...x }]));
  for (const [id, patch] of Object.entries(vc?.items || {})) {
    if (map.has(id)) map.set(id, { ...map.get(id), ...patch });
  }
  for (const x of vc?.extra || []) map.set(x.id, { qty: 1, pns: [], ...map.get(x.id), ...x });
  for (const [id, patch] of Object.entries(user || {})) {
    if (map.has(id)) map.set(id, { ...map.get(id), ...patch, userEdited: true });
    else if (patch?.name) map.set(id, { qty: 1, pns: [], ...patch, id, custom: true });
  }
  for (const id of vc?.remove || []) map.delete(id);
  return [...map.values()];
}
