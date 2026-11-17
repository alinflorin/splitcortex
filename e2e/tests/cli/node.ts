import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { appUrl, gatewayUrl } from '../../src/env.ts';
import { ensureModelFile } from '../../src/model.ts';

/** The binary under test (the workflow installs the newest release; locally `cargo build --release`). */
export const bin = resolve(
  process.env.E2E_CLI_BIN ?? '../src/cli-node/target/release/splitcortex-node',
);
export const MODEL = 'e2e-smollm2-135m';
export const hi = [{ role: 'user', content: 'Say hello.' }];

/** One OpenAI chat request through the gateway. */
export const chat = (key: string, body: Record<string, unknown> = {}) =>
  fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: hi, ...body }),
  });

export interface ServingNode {
  ws: Workspace;
  modelId: string;
  /** An org-wide API key of the workspace. */
  secret: string;
  /** Polls until the gateway serves the model (the node has downloaded and loaded it). */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * A throwaway org + pool serving the cached test model, with a real CLI node enrolled in it and running. Slow parts
 * (model download from Hugging Face, upload, the node fetching and loading it) happen here and in `ready()`.
 */
export async function startServingNode(): Promise<ServingNode> {
  expect(existsSync(bin), `no CLI binary at ${bin} (set E2E_CLI_BIN)`).toBe(true);
  const home = mkdtempSync(join(tmpdir(), 'splitcortex-cli-e2e-'));
  const env = { ...process.env, SPLITCORTEX_HOME: home, SPLITCORTEX_URL: appUrl };
  const file = await ensureModelFile(); // cached between runs, downloaded when missing
  const ws = await createWorkspace();
  const model = await ws.serveModel(MODEL, file);
  const { secret } = await ws.apiKey();
  await promisify(execFile)(bin, ['join', '--code', await ws.code()], { env });
  let stderr = '';
  const serving: ChildProcess = spawn(bin, ['run'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  serving.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  return {
    ws,
    modelId: model.id,
    secret,
    async ready() {
      // Until the node is online with the model loaded the gateway answers 404/503; then the first call succeeds.
      await waitFor(
        'the gateway to serve the model',
        async () => {
          if (serving.exitCode !== null) throw new Error(`run exited early:\n${stderr}`);
          const r = await chat(secret, { max_tokens: 1 });
          if (r.status === 404 || r.status === 503) return undefined;
          expect(r.status, stderr).toBe(200);
          return true;
        },
        240_000,
        3_000,
      );
    },
    async stop() {
      serving.kill('SIGTERM');
      await ws.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
