# Garage Health

Vehicle maintenance tracker with a 3D health map. It's built for any vehicle, and the first profile is a 2001 Mustang 3.8 V6 with the T-5.

- **3D model**: a stylized, parametric vehicle (coupe, sedan, hatch, SUV or truck) where every maintainable item is its own mesh. Each part's color comes from its health: green is good, yellow is watch, orange is due soon, red is overdue or bad and **blinks**, and grey means no data. You can orbit, zoom, tap a part, use x-ray or hide the body, and use the exploded view.
- **Every part is tracked the same way**: brand, model, part number, manufacture date (DOT code for tires), install date and miles, price, vendor, warranty, measurements (tread, pads, battery voltage, compression…), replacement history, photos and active issues.
- **Health** is the worst of four signals: the service interval (miles or months), the component's age, its latest measurement, and active flags (symptoms you report, live OBD alerts, trouble codes).
- **Service log**: each entry has a date, miles, type, cost, shop, labor hours, notes, the parts it touched and the parts it replaced. It can carry **before and after photos plus PDF, WebP or photo receipts**. Logging a service resolves that part's flags.
- **Tire rotation** offers rearward cross, forward cross, X, front-rear and side-to-side patterns. Each tire keeps its own position history.
- **OBD**:
  - **Live**: connects over Bluetooth Classic to an ELM327 (Android app). It reads coolant, RPM, speed, fuel trims, O2 sensors, MAF, timing, load, IAT and voltage. Out-of-range values flag the parts behind them, for example high LTFT flags the intake gaskets, MAF and O2 sensors.
  - **Trouble codes**: reads stored and pending codes, which light the related parts (misfires blink the plugs, wires and coils). Codes can be cleared after a confirmation.
  - **CSV import** from OBD Fusion, OBDroid and Torque. Columns are matched by name and units are converted to °F and mph. Each import gets a chart and min/avg/max stats, and out-of-range readings can be flagged onto parts in one click.
  - **Demo adapter**: a simulated adapter for trying all of this in a browser.
- **Specs** sheet per vehicle: fluids, capacities, torque values and part numbers. Mustang fluids, capacities and filter/plug numbers come from the 2001 owner guide; torque values are still marked "verify".
- **Parts catalog** (Specs → Parts catalog): everything you can buy or make for the vehicle, grouped as fluids, filters, gaskets, seals, wear items, replacement parts, sensors, hardware and fabricable items. Each line has spec, capacity, part numbers and how to fabricate it where that makes sense, and links to the parts it serves (also shown on each part's page). Unconfirmed numbers are marked "verify". Lines are editable and export to CSV.
- **Inspect**: a 150+ point inspection (220 points for the Mustang) and a battery of 39 tests (compression, leak-down, vacuum, cooling pressure, block test, fuel pressure, injector balance, battery load, charging, voltage drop, parasitic draw, fuel trims, O2, backpressure, brake measurements, suspension play, ride height, clutch slip and more). Every check and test maps to parts. Measurements pass or fail against limits automatically. Finishing a run flags watch/fail items on their parts (yellow/orange/red on the model, critical safety items blink), clears flags for items that now pass, marks passed parts green and saves measurements (tread, pads, battery, compression) into each part's history.
- **Garage**: multiple vehicles built from templates, configuration options that decide which parts exist, custom parts, odometer history, and a full JSON backup including photos.

## CSV export
- **Garage → Export CSV:** service log, parts & health (every part with brand, part number, install date and miles, interval, last service, health and active issues), tires (current and removed, with DOT age, tread and position history) and costs by year and system.
- **Log tab → Export CSV:** the service log.
- **OBD session → Export CSV:** uses OBD Fusion-style `Name (unit)` columns, and the file re-imports into the app.
- **Inspection → Export CSV:** every check with its result, value, note and the parts it covers, plus test results.

On Android, exports open the share sheet so you can save to Files or Drive, or email them.

## Run locally (development)

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from your phone on the same Wi-Fi)
```

## PC app (GitHub Pages)

`.github/workflows/pages.yml` publishes the web build on every push to `main` at
**https://greiye.github.io/garage-health/**. Open it in Chrome or Edge and click the install icon in the address bar to run it as a desktop app (it works offline too).

One-time setup: go to repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

**Live OBD on PC** (Chrome or Edge, using Web Serial):
- **Bluetooth ELM327:** pair it in Windows **Settings → Bluetooth & devices** (PIN 1234 or 0000). Windows then creates a COM port. In the app, go to **OBD → Connect adapter (COM/USB)** and pick "Standard Serial over Bluetooth link". If two show up, the outgoing one is usually the lower number.
- **BLE adapter** (OBDLink CX, Vgate iCar Pro BLE, etc.): no pairing needed. Use **OBD → Connect BLE adapter** and pick it from the list.
- **USB ELM327:** plug it in and pick its port. If it doesn't respond, try a different baud rate (38400, then 115200 or 9600).

**Data** is stored on each device. Turn on sync (below) to keep the phone and PC matched, or move it by hand with **Garage → Export backup** and **Restore backup**.

## Sync phone ⇄ PC (GitHub)
Records, photos and receipts sync through a **separate private repo** that you own. They are never stored in this app repo.
1. Create a private repo, e.g. `garage-health-data`, with a README so it isn't empty.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to that repo, with **Contents: Read and write**.
3. In the app, go to **Garage → Sync phone ⇄ PC → Set up**. On a fresh device, use "Already using it on another device? Sync from GitHub" on the first screen.

The app syncs when it opens, when you return to it, and about 15 seconds after a change. The header icon shows the state, and tapping it syncs right away. If both devices changed records before syncing, you choose which copy to keep. The other copy is saved under `garage/conflicts/`, and Git history keeps every version. The token stays on the device and is never included in backups or synced data.

## Android app (needed for the Bluetooth ELM327)

**Option A, Android Studio:**
```bash
npm install
npm run cap:sync   # builds the web app and copies it into android/
npm run cap:open   # opens Android Studio → Run on your Pixel (USB debugging on)
```

**Option B, GitHub Actions:** push this folder to a GitHub repo. `.github/workflows/android.yml` builds a debug APK on every push to `main`, and you download it from the run's Artifacts. To install it, allow "Install unknown apps" for your browser or file manager.

### Connecting the adapter
1. Plug the ELM327 into the OBD port and turn the key to ON.
2. Pair it in **Android Settings → Bluetooth** (the PIN is usually `1234` or `0000`).
3. In the app, go to **OBD → Find adapter** (or **Enter MAC**). Allow the "Nearby devices" permission.
4. Close OBD Fusion and OBDroid first, because only one app can hold the Bluetooth link.

**2001 Mustang note:** 1996–2003 Fords use **SAE J1850 PWM**. Many cheap ELM327 clones don't support PWM. If OBD Fusion works with your adapter, this app will too, since it uses the same ELM327 commands.

## Project layout

```
src/data/templates.js   part catalog generated from vehicle options + presets (Mustang specs)
src/data/catalog.js     generic parts catalog generated from vehicle options
src/data/catalogs/*     per-vehicle catalog data (part numbers, specs, capacities)
src/data/inspection.js  inspection checklist + test battery generated from options, scoring
src/data/health.js      health scoring (interval, age, measurement, flags → color, blink)
src/data/repo.js        vehicles, services, components, rotation, flags (IndexedDB via Dexie)
src/scene/carModel.js   parametric 3D vehicle, one mesh group per part slot
src/scene/viewer.js     Three.js viewer: picking, colors, blink, x-ray, explode
src/obd/elm327.js       ELM327 protocol, Bluetooth Classic transport, demo adapter, poller
src/obd/pids.js         PID decoders + live alert rules
src/obd/dtc.js          DTC parsing, descriptions, code → part mapping
src/obd/csvImport.js    OBD Fusion / OBDroid / generic CSV import
src/ui/*                panels and forms
```

Data stays on the device (IndexedDB). Use **Garage → Export backup** to move it or keep a copy.

## Not built yet
- Push reminders and notifications
- Cloud sync between phone and PC
- PDF service-history export
- Loading your own `.glb` model per vehicle
