import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseUrl } from '../env';
import type { NodeDriver } from '../nodeSuite';
import { cliNodeBinary } from '../releases';

let proc: ChildProcess | undefined;
let home: string | undefined;

// The released CLI node (latest, or E2E_CLI_VERSION): `join` with the code, then `run` as a child process.
export const cliNode: NodeDriver = {
  title: 'cli node',
  unavailable: async () => null,
  async join(code) {
    const bin = await cliNodeBinary();
    home = mkdtempSync(join(tmpdir(), 'splitcortex-e2e-'));
    const env = { ...process.env, SPLITCORTEX_HOME: home, SPLITCORTEX_URL: baseUrl() };
    execFileSync(bin, ['join', '--url', baseUrl(), '--code', code], { env, stdio: 'inherit' });
    proc = spawn(bin, ['run'], { env, stdio: 'inherit' });
  },
  async stop() {
    proc?.kill('SIGTERM');
    proc = undefined;
    if (home) rmSync(home, { recursive: true, force: true });
    home = undefined;
  },
};
