import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { optional } from './env';

const REPO = 'alinflorin/splitcortex';
const CACHE = resolve('.cache'); // cached between CI runs, keyed on the release tag

interface Asset {
  name: string;
  browser_download_url: string;
}

async function gh(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'splitcortex-e2e' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

/** `stream-latest` (rolling) unless a version X.Y.Z is given. */
const tagOf = (stream: 'cli-node' | 'mobile-node', version?: string) =>
  version ? `${stream}-v${version.replace(/^v/, '')}` : `${stream}-latest`;

async function download(tag: string, pick: (a: Asset) => boolean, dir: string): Promise<string> {
  const rel = (await (
    await gh(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`)
  ).json()) as {
    assets: Asset[];
  };
  const asset = rel.assets.find(pick);
  if (!asset)
    throw new Error(
      `release ${tag} has no matching asset (${rel.assets.map((a) => a.name).join(', ')})`,
    );
  const out = join(CACHE, dir, asset.name);
  if (!existsSync(out)) {
    mkdirSync(join(CACHE, dir), { recursive: true });
    writeFileSync(out, Buffer.from(await (await gh(asset.browser_download_url)).arrayBuffer()));
  }
  return out;
}

function cliTarget(): string {
  const a = arch() === 'arm64' ? 'aarch64' : 'x86_64';
  if (platform() === 'linux') return `${a}-unknown-linux-gnu`;
  if (platform() === 'darwin' && a === 'aarch64') return 'aarch64-apple-darwin';
  throw new Error(`No CLI node build for ${platform()} ${arch()}`);
}

/** Downloads (cached) and unpacks the CLI node release; returns the path of the binary. */
export async function cliNodeBinary(): Promise<string> {
  const version = optional('E2E_CLI_VERSION');
  const tag = tagOf('cli-node', version);
  const target = cliTarget();
  const archive = await download(tag, (a) => a.name === `splitcortex-node-${target}.tar.gz`, tag);
  const dir = join(CACHE, tag, 'unpacked');
  mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  const find = (d: string): string | null => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        const r = find(p);
        if (r) return r;
      } else if (e.name === 'splitcortex-node') return p;
    }
    return null;
  };
  const bin = find(dir);
  if (!bin) throw new Error('splitcortex-node not found in the archive');
  chmodSync(bin, 0o755);
  return bin;
}

/** Downloads (cached) the Android APK of the mobile node release. */
export async function mobileNodeApk(): Promise<string> {
  const tag = tagOf('mobile-node', optional('E2E_MOBILE_VERSION'));
  return download(tag, (a) => a.name.endsWith('.apk'), tag);
}
