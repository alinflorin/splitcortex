import { mkdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function adb(...args: string[]): Promise<string> {
  const { stdout } = await run('adb', args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function deviceReady(): Promise<boolean> {
  try {
    return (await adb('get-state')).trim() === 'device';
  } catch {
    return false;
  }
}

interface Hit {
  text: string;
  x: number;
  y: number;
}

/** Visible texts/descriptions of the foreground screen with their centres (uiautomator dump). */
async function screen(): Promise<Hit[]> {
  const xml = await adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  const hits: Hit[] = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const tag = m[0];
    const text = /\btext="([^"]*)"/.exec(tag)?.[1] || /content-desc="([^"]*)"/.exec(tag)?.[1] || '';
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (text && b) {
      hits.push({
        text,
        x: Math.round((Number(b[1]) + Number(b[3])) / 2),
        y: Math.round((Number(b[2]) + Number(b[4])) / 2),
      });
    }
  }
  return hits;
}

/** What the device showed and logged when a wait gave up: the screen's texts, the foreground app, crashes. */
async function diagnostics(): Promise<string> {
  const part = async (label: string, f: () => Promise<string>) => {
    try {
      return `--- ${label}\n${(await f()).trim()}`;
    } catch (e) {
      return `--- ${label}: unavailable (${String(e)})`;
    }
  };
  await part('screenshot', async () => {
    const { stdout } = await run('adb', ['exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/device-screen.png', stdout);
    return 'saved to test-results/device-screen.png';
  });
  return [
    await part('screen texts', async () => (await screen()).map((h) => h.text).join(' | ')),
    await part('foreground', async () =>
      (await adb('shell', 'dumpsys', 'activity', 'activities'))
        .split('\n')
        .filter((l) => /topResumedActivity|mResumedActivity/.test(l))
        .join('\n'),
    ),
    await part('logcat (errors)', async () =>
      (
        await adb(
          'logcat',
          '-d',
          '-t',
          '300',
          '-v',
          'brief',
          'AndroidRuntime:E',
          'ReactNativeJS:E',
          'DEBUG:F',
          '*:S',
        )
      ).slice(-4000),
    ),
  ].join('\n');
}

export async function waitForText(text: RegExp | string, timeoutMs = 60_000): Promise<Hit> {
  const end = Date.now() + timeoutMs;
  const match = (t: string) => (typeof text === 'string' ? t === text : text.test(t));
  for (;;) {
    try {
      const hit = (await screen()).find((h) => match(h.text));
      if (hit) return hit;
    } catch {
      // the UI is mid-transition; try again
    }
    if (Date.now() > end) {
      throw new Error(`"${text}" never appeared on the device screen\n${await diagnostics()}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function tapText(text: RegExp | string, timeoutMs = 60_000) {
  const hit = await waitForText(text, timeoutMs);
  await adb('shell', 'input', 'tap', String(hit.x), String(hit.y));
}
