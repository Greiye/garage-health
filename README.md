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
- **Specs** sheet per vehicle: fluids, capacities, torque values and part numbers. The Mustang values are marked "verify".
- **Garage**: multiple vehicles built from templates, configuration options that decide which parts exist, custom parts, odometer history, and a full JSON backup including photos.

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
- **USB ELM327:** plug it in and pick its port. If it doesn't respond, try a different baud rate (38400, then 115200 or 9600).

**Data** is stored separately on each device. To move your history between phone and PC, use **Garage → Export backup** on one and **Restore backup** on the other.

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
