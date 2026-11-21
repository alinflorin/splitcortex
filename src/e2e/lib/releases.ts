import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { optional } from './env';

const REPO = 'alinflorin/splitcortex';
const CACHE = resolve('.cache'); // cached between CI runs, keyed on the release tag

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
  /** `sha256:<hex>` as GitHub computes it for an uploaded asset. */
  digest?: string | null;
}

/** Whether the cached file is the asset as published now (the rolling `*-latest` tags are re-uploaded under one name). */
function isCurrent(file: string, asset: Asset): boolean {
  if (!existsSync(file) || statSync(file).size !== asset.size) return false;
  const want = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
  return !want || createHash('sha256').update(readFileSync(file)).digest('hex') === want;
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
  if (!isCurrent(out, asset)) {
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

/**
 * Downloads (cached) and unpacks the CLI node release; returns the path of the binary.
 *
 * The archive is unpacked once into a folder named after it and never touched again: a running node keeps using its
 * executable and the engine library next to it (it looks its own path up when it loads a model), and unpacking over
 * them (tar replaces the files) made a running node fail with "No such file or directory". Several nodes, and the
 * other node projects running at the same time, share the folder. The unpacking happens in a private folder that is
 * moved into place, so nobody sees a half-unpacked one.
 */
export async function cliNodeBinary(): Promise<string> {
  const version = optional('E2E_CLI_VERSION');
  const tag = tagOf('cli-node', version);
  const target = cliTarget();
  const archive = await download(tag, (a) => a.name === `splitcortex-node-${target}.tar.gz`, tag);
  const dir = join(CACHE, tag, `unpacked-${Math.floor(statSync(archive).mtimeMs)}`);
  if (!existsSync(dir)) {
    const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(tmp, { recursive: true });
    try {
      execFileSync('tar', ['-xzf', archive, '-C', tmp]);
      renameSync(tmp, dir);
    } catch (e) {
      // Another process moved its copy into place first: use that one.
      if (!existsSync(dir)) throw e;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
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
