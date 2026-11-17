// Downloads Google's official LiteRT-LM C API release (a zip of headers and per-platform shared libraries), checks its
// SHA-256 against the pinned value and copies the library for one target into src-tauri/resources/litert/, from where
// the Tauri bundle ships it (the app loads it at run time, see src-tauri/src/engine). Usage:
//   node scripts/fetch-litert.mjs [rust-target-triple] [--required]
// Without a triple it uses the host's. A target Google publishes no library for (macOS x86_64) gets nothing: the app
// builds, but the engine reports that it is unavailable. --required fails on such a target instead.
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const VERSION = 'v0.19.1';
const ASSET = 'litert_lm_c_api-1.0.0.zip';
const SHA256 = '1d430d80eaf536f696a4922270ba55eb3d112189ac198c3066d487a45e3b4d4c';
const URL = `https://github.com/google-ai-edge/LiteRT-LM/releases/download/${VERSION}/${ASSET}`;

// rust target -> [path inside the zip, file name the app looks for]
const LIBS = {
  'x86_64-unknown-linux-gnu': ['lib/linux_x86_64/liblitert-lm.so', 'liblitert-lm.so'],
  'aarch64-unknown-linux-gnu': ['lib/linux_arm64/liblitert-lm.so', 'liblitert-lm.so'],
  'aarch64-apple-darwin': ['lib/macos_arm64/liblitert-lm.dylib', 'liblitert-lm.dylib'],
  'x86_64-pc-windows-msvc': ['lib/windows_x86_64/bin/litert-lm.dll', 'litert-lm.dll'],
};

const args = process.argv.slice(2);
const required = args.includes('--required');
const hostTriple = () =>
  execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1] ?? '';
const triple = args.find((a) => !a.startsWith('--')) ?? hostTriple();

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'resources',
  'litert',
);
mkdirSync(root, { recursive: true });
for (const f of readdirSync(root)) if (f !== '.gitkeep') rmSync(join(root, f), { force: true });

const entry = LIBS[triple];
if (!entry) {
  const msg = `No LiteRT-LM library is published for ${triple}; the engine will be unavailable in this build.`;
  if (required) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

const cache = join(root, '..', '.cache');
mkdirSync(cache, { recursive: true });
const zipPath = join(cache, `${VERSION}-${ASSET}`);
let zip;
try {
  zip = new Uint8Array(readFileSync(zipPath));
} catch {
  // not cached yet
}
if (!zip || createHash('sha256').update(zip).digest('hex') !== SHA256) {
  console.log(`Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  zip = new Uint8Array(await res.arrayBuffer());
  const got = createHash('sha256').update(zip).digest('hex');
  if (got !== SHA256)
    throw new Error(`Checksum mismatch for ${ASSET}: expected ${SHA256}, got ${got}`);
  // Write next to the target and rename, so a concurrent run never sees a half-written cache file.
  const tmp = `${zipPath}.${process.pid}.tmp`;
  writeFileSync(tmp, zip);
  renameSync(tmp, zipPath);
}
const [inside, outName] = entry;
const files = unzipSync(zip, { filter: (f) => f.name === inside });
const data = files[inside];
if (!data) throw new Error(`${inside} is not in ${ASSET}`);
writeFileSync(join(root, outName), data);
console.log(
  `LiteRT-LM ${VERSION}: ${outName} for ${triple} (${(data.length / 1048576).toFixed(0)} MiB)`,
);
