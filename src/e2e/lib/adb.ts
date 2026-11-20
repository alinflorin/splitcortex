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
    if (Date.now() > end) throw new Error(`"${text}" never appeared on the device screen`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function tapText(text: RegExp | string, timeoutMs = 60_000) {
  const hit = await waitForText(text, timeoutMs);
  await adb('shell', 'input', 'tap', String(hit.x), String(hit.y));
}
