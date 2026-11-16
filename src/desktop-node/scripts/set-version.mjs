// Sets the app version everywhere it lives (package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json) from the
// release tag, so CI builds `desktop-node-vX.Y.Z` as exactly X.Y.Z. Usage: node scripts/set-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: set-version.mjs X.Y.Z');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const edit = (file, fn) => {
  const p = join(root, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
edit('package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${version}"`));
edit('src-tauri/tauri.conf.json', (s) =>
  s.replace(/"version": "[^"]*"/, `"version": "${version}"`),
);
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]*"/m, `version = "${version}"`));
console.log(`Version set to ${version}`);
