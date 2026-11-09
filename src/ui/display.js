import { getSetting, setSetting } from '../data/db.js';
import { setKeepAwake } from '../obd/elm327.js';

// "Keep screen on" setting for the whole app (per device, never synced).
export const getKeepScreenOn = async () => !!(await getSetting('keepScreenOn', false));

export async function setKeepScreenOn(on) {
  await setSetting('keepScreenOn', !!on);
  await setKeepAwake(!!on);
}

// Call at startup and whenever a screen that held the screen on closes.
export async function applyKeepScreenOn() {
  await setKeepAwake(await getKeepScreenOn());
}
