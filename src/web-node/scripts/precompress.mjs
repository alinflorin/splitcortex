// Writes a Brotli copy (`file.br`) next to every compressible file of `dist`, for Caddy's `precompressed br`: the
// static server then sends the smallest encoding without compressing on every request. Run after `pnpm build` (the
// Dockerfile does). Already-compressed formats (fonts, images) are skipped, and so is any file where Brotli does not
// pay off.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.wasm', '.xml']);
const MIN_BYTES = 512;
// Quality 11 is far too slow for the tens-of-MB WASM files (minutes per file in the image build); 9 is much faster and
// only slightly larger. Everything else is small, so it keeps the best ratio.
const quality = (path) => (extname(path) === '.wasm' ? 9 : 11);

let files = 0;
let before = 0;
let after = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (TYPES.has(extname(name)) && statSync(path).size >= MIN_BYTES) compress(path);
  }
};
const compress = (path) => {
  const input = readFileSync(path);
  const output = brotliCompressSync(input, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality(path),
      [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  });
  if (output.length >= input.length) return;
  writeFileSync(`${path}.br`, output);
  files++;
  before += input.length;
  after += output.length;
};

walk(root);
console.log(`brotli: ${files} files, ${before} -> ${after} bytes`);
