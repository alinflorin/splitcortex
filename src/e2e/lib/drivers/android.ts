import { adb, deviceReady, tapText, waitForText } from '../adb';
import { baseUrl, isLocal } from '../env';
import type { NodeDriver } from '../nodeSuite';
import { mobileNodeApk } from '../releases';

const PACKAGE = 'com.splitcortex.node';
let installed = false;

// The released APK (latest, or E2E_MOBILE_VERSION) on an emulator/device reachable through adb: opened with the
// enrollment deep link (the same one the QR carries), then driven through its own screens.
export const android: NodeDriver = {
  title: 'android node',
  unavailable: async () => ((await deviceReady()) ? null : 'no adb device or emulator is running'),
  async join(code) {
    if (!installed) {
      await adb('install', '-r', '-g', await mobileNodeApk());
      installed = true;
    }
    // Local hosts resolve to 127.0.0.1, which on the emulator is itself: send port 443 back to this machine.
    if (isLocal()) await adb('reverse', 'tcp:443', 'tcp:443');
    await adb('shell', 'am', 'force-stop', PACKAGE);
    await adb('shell', 'pm', 'clear', PACKAGE);
    await adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS').catch(
      () => undefined,
    );
    const link = `splitcortex://enroll?url=${encodeURIComponent(`${baseUrl()}/api`)}&code=${code}`;
    await adb(
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `'${link}'`,
      PACKAGE,
    );
    await tapText('Enroll');
    await tapText('Start');
    await waitForText(/Connected to the gateway|Connecting/, 120_000);
  },
  async stop() {
    await adb('shell', 'am', 'force-stop', PACKAGE).catch(() => undefined);
    await adb('shell', 'pm', 'clear', PACKAGE).catch(() => undefined);
  },
};
