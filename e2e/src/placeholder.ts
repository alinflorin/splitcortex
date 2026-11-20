import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A few bytes with a .litertlm name, enough to upload as a model of any kind (the control plane does not look inside
 * the file) and assign to a pool. No node can load it: for the rules that only need a model to exist (kind checks,
 * what the gateway lists, refused benchmarks) and for the simulated nodes of the perf suite.
 */
export function placeholderModel(): {
  file: { path: string; fileName: string; sizeBytes: number };
  remove: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'splitcortex-placeholder-'));
  const path = join(dir, 'placeholder.litertlm');
  writeFileSync(path, 'placeholder model for the e2e suites');
  return {
    file: { path, fileName: 'placeholder.litertlm', sizeBytes: statSync(path).size },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
