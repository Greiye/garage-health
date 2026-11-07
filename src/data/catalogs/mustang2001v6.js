// 2001 Ford Mustang 3.8L OHV V6 (Essex), T-5 manual, 7.5 in rear axle.
//
// verified: true  = printed in the 2001 Mustang owner guide
//                   ("Capacities and specifications" / "Motorcraft part numbers").
// verified: false = commonly listed for this car but NOT confirmed here.
//                   Check the number against your VIN at a parts counter
//                   or on the old part before buying.
// pn: null        = no reliable number known; look it up by VIN.

const OG = 'Owner guide 2001';
const ok = (brand, pn) => ({ brand, pn, verified: true, source: OG });
const chk = (brand, pn, note) => ({ brand, pn, verified: false, note });

export default {
  id: 'mustang-2001-v6-manual',
  label: '2001 Mustang 3.8 V6 manual',
  // OBD healthy ranges used by the diagnostics engine (typical values for a
  // healthy 3.8 Essex; 192°F thermostat, MAF-based EEC-V). Edit per car as needed.
  obdRanges: {
    displacementL: 3.8,
    redline: 6000,
    idleRpm: [575, 850],
    coolantRun: [188, 220],
    idleTiming: [8, 26],
    mafIdlePerL: [0.7, 1.4],
  },
  items: {
    // ---- Fluids (all from the owner guide) ----
    f_oil: { spec: 'SAE 5W-20, Ford WSS-M2C153-H, API certified', capacity: '5.0 qt (4.7 L) with filter', pns: [ok('Motorcraft', 'XO-5W20-QSP')] },
    f_coolant: { spec: 'Green: Motorcraft Premium VC-4-A (ESE-M97B44-A) or Gold: Premium Gold VC-7-A (WSS-M97B51-A1). Owner guide: use the type originally equipped.', capacity: '11.8 qt (11.2 L) total system', pns: [ok('Motorcraft', 'VC-4-A'), ok('Motorcraft', 'VC-7-A')] },
    f_brake: { spec: 'DOT 3, ESA-M6C25-A', capacity: 'Fill to line on reservoir; a full flush uses about 1 qt', pns: [ok('Motorcraft', 'C6AZ-19542-AB')] },
    f_ps: { spec: 'MERCON ATF', capacity: 'Keep in FULL HOT range on dipstick; flush about 1 qt', pns: [ok('Motorcraft', 'XT-2-QM')] },
    f_trans: { spec: 'MERCON ATF (not MERCON V; do not mix). V8 cars use Mobil 1 synthetic ATF instead.', capacity: '5.6 pt (2.6 L), fill to bottom of fill hole on level ground', pns: [ok('Motorcraft', 'XT-2-QDX')] },
    f_rear_diff: { spec: '7.5 in axle: SAE 80W-90, WSP-M2C197-A. If an 8.8 in axle was swapped in: 75W-140 synthetic, WSP-M2C192-A, 4.25 pt.', capacity: '3.25 pt (1.5 L), 1/4 to 9/16 in below fill hole', pns: [ok('Motorcraft', 'XY-80W90-QL'), ok('Motorcraft', 'XY-75W140-QL (8.8 in)')] },
    f_friction_mod: { spec: 'EST-M2C118-A. Traction-Lok axles only.', capacity: '4 oz (118 ml)', pns: [ok('Ford', 'C8AZ-19B546-A')] },
    f_ac: { spec: 'R-134a. Charge amount and oil type are on the under-hood A/C label.', pns: [] },
    f_washer: { capacity: '4.0 qt (3.8 L)', pns: [ok('Motorcraft', 'C9AZ-19550-AC')] },
    f_fuel: { spec: '87 octane unleaded', capacity: '15.7 gal (59.4 L)' },
    f_brake_grease: { spec: 'ESE-M1C171-A, for caliper slide rails', pns: [ok('Motorcraft', 'WA-10 (D7AZ-19A331-A)')] },
    f_lock: { spec: 'Hinges/latches: multi-purpose grease ESB-M1C93-B. Weatherstrip: silicone ESR-M13P4-A.', pns: [ok('Ford', 'D0AZ-19584-AA (grease)'), ok('Ford', 'F7AZ-19G208-BA (weatherstrip silicone)')] },

    // ---- Filters ----
    flt_oil: { pns: [ok('Motorcraft', 'FL-400S')], note: 'FL-820S is the 4.6 V8 filter. The owner guide lists FL-400S for the 3.8.' },
    flt_air: { pns: [ok('Motorcraft', 'FA-1611')], note: 'FA-1634 is the V8 element.' },
    flt_fuel: { pns: [ok('Motorcraft', 'FG-986')], note: 'Mounted on the frame rail under the car. Needs spring-lock / hairpin clip tools.' },
    flt_pcv: { pns: [ok('Motorcraft', 'EV-152')] },

    // ---- Wear items ----
    w_plugs: { spec: 'Gap 0.052-0.056 in (1.3-1.4 mm). Firing order 1-4-2-5-3-6.', pns: [ok('Motorcraft', 'AWSF-42EE')], note: 'Owner guide: a replacement must use the same suffix letter shown on the engine (VECI) decal. Reinstall inspected plugs in the same cylinder.' },
    w_wires: { pns: [chk('Motorcraft', null, 'Look up by VIN; sold as a 6-wire set for the 3.8 EDIS coil.')] },
    w_belt: { pns: [chk('Motorcraft', null, 'Depends on A/C. Read the length off the old belt or the routing decal.')] },
    w_pads_f: { pns: [chk('FMSI', 'D804', '1999-2004 Mustang base front pads are usually listed as D804. Confirm against your caliper.')] },
    w_shoes_r: { spec: 'Rear drum brakes (non-ABS V6). Max drum diameter is cast inside the drum.', pns: [chk('—', null, 'Look up by VIN; 9 in drums on most V6 cars.')] },
    w_rotors_f: { spec: 'Use the MIN TH value cast into the rotor hat.', pns: [chk('—', null, 'Non-Cobra 1999-2004 front rotor; confirm diameter on the old rotor.')] },
    w_clutch_kit: { spec: 'T-5 with cable clutch and self-adjusting quadrant.', pns: [chk('—', null, 'Confirm disc diameter and spline count on the old disc (you swapped this transmission).')] },
    w_tires: { spec: 'Size and pressure are on the driver door placard.' },
    w_wipers: { pns: [chk('—', null, 'Usually 20 in driver and passenger on SN95. Measure the old blades.')] },

    // ---- Parts ----
    p_battery: { spec: 'Group 58 class battery', pns: [ok('Motorcraft', 'BXT-59')] },
    p_coil: { spec: 'EDIS 6-tower coil pack', pns: [chk('Motorcraft', 'DG-508', 'Commonly listed for 1999-2004 3.8 Mustang. Confirm on the old coil.')] },
    p_thermostat: { spec: '195 °F typical for this engine (confirm stamping on old thermostat)', pns: [chk('Motorcraft', null, 'Look up by VIN.')] },
    p_clutch_cable: { note: 'Many owners replace the plastic self-adjust quadrant with an aluminum quadrant, adjustable cable and firewall adjuster.' },
    p_rad_cap: { spec: 'Pressure is stamped on the cap; test it against that value.' },

    // ---- Sensors ----
    e_dpfe: { note: 'DPFE sensor and its two rubber hoses are a common P0401 cause on this engine.', pns: [chk('Motorcraft', 'DPFE-15', 'Aluminum DPFE commonly listed for this engine. Confirm the shape of yours.')] },
  },
  extra: [
    { id: 'g_intake_3.8', cat: 'gasket', name: 'Lower intake gasket set (upgraded design)', parts: ['intake_gasket'], note: 'The 3.8 is known for lower intake gasket coolant leaks. Use a revised (metal-core / updated) set and new coolant.', pns: [chk('Fel-Pro', null, 'Look up the MS-series set by VIN.')] },
    { id: 'g_head_bolts_3.8', cat: 'hardware', name: 'Head bolts (torque-to-yield, replace)', parts: ['head_gaskets'], note: '3.8 head bolts are generally torque-to-yield (single use). Confirm and use the torque sequence from the service manual.', pns: [] },
    { id: 'p_quadrant', cat: 'part', name: 'Clutch quadrant, adjustable cable & firewall adjuster (upgrade)', parts: ['clutch_cable'], fab: 'Firewall adjuster can be made from billet if you have a lathe.', pns: [] },
  ],
};
