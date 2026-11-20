import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from './api.ts';
import { appUrl, gatewayUrl } from './env.ts';
import { ensureModelFile } from './model.ts';
import { placeholderModel } from './placeholder.ts';

// The suites in tests/serving need *a* node that serves a model; which kind is irrelevant to them. The CLI node is used
// because it is headless and runs on a plain CI runner. To test through another kind, only this file changes.

/** The node binary (the workflow installs the newest cli-node release; locally `cargo build --release`). */
export const bin = resolve(process.env.E2E_CLI_BIN ?? '.cache/cli-node/splitcortex-node');
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
  /** The tail of what the node process printed (for failure messages). */
  log(): string;
  /** Stops the node process (a SIGTERM, as a user would) and waits for it to exit; the enrollment stays. */
  halt(): Promise<void>;
  /** Starts the node again from its enrollment (no wait; call `ready()`). */
  restart(): void;
  stop(): Promise<void>;
}

/** One OpenAI embeddings request through the gateway. */
export const embed = (key: string, body: Record<string, unknown> = {}) =>
  fetch(`${gatewayUrl}/v1/embeddings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: 'hello', ...body }),
  });

/** The name the embedding model gets in the throwaway org of `startEmbeddingNode`. */
export const EMBED_MODEL = 'e2e-embedding';

/** A Hugging Face link to a real `.litertlm` embedding model (for example EmbeddingGemma); the real embedding tests skip without it. */
export const embeddingModelUrl = process.env.E2E_EMBEDDING_MODEL_URL;

/**
 * Enrolls a CLI node in the pool of `ws` and runs it. `probe` is one cheap request that succeeds once the gateway
 * serves the pool's model through this node (404/503 until then).
 */
async function runNode(
  ws: Workspace,
  modelId: string,
  secret: string,
  probe: (secret: string) => Promise<Response>,
): Promise<ServingNode> {
  expect(existsSync(bin), `no CLI binary at ${bin} (set E2E_CLI_BIN)`).toBe(true);
  const home = mkdtempSync(join(tmpdir(), 'splitcortex-cli-e2e-'));
  const env = {
    ...process.env,
    SPLITCORTEX_HOME: home,
    SPLITCORTEX_URL: appUrl,
    RUST_LOG: process.env.RUST_LOG ?? 'info',
  };
  await promisify(execFile)(bin, ['join', '--code', await ws.code()], { env });
  // A CI runner has no GPU (Vulkan: "Found no drivers"), so "auto" would pick a backend that cannot load the model.
  await promisify(execFile)(bin, ['config', '--compute', 'cpu'], { env });
  let stderr = '';
  let serving: ChildProcess | undefined;
  const launch = () => {
    serving = spawn(bin, ['run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    // The node logs to stdout (tracing's default writer) and the engine library to stderr: keep the tail of both.
    for (const out of [serving.stdout, serving.stderr])
      out?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  };
  launch();
  return {
    ws,
    modelId,
    secret,
    log: () => stderr,
    async ready() {
      // Until the node is online with the model loaded the gateway answers 404/503; then the first call succeeds.
      await waitFor(
        'the gateway to serve the model',
        async () => {
          if (serving?.exitCode !== null) throw new Error(`run exited early:\n${stderr}`);
          const r = await probe(secret);
          if (r.status === 404 || r.status === 503) return undefined;
          expect(r.status, `${await r.clone().text()}\n${stderr}`).toBe(200);
          return true;
        },
        // an embedding model is downloaded by the node first: allow for a slow network
        480_000,
        3_000,
      ).catch((e: Error) => {
        throw new Error(`${e.message}\nnode log:\n${stderr}`);
      });
    },
    async halt() {
      const p = serving;
      if (!p || p.exitCode !== null) return;
      const exited = new Promise((r) => p.once('exit', r));
      p.kill('SIGTERM');
      await exited;
    },
    restart() {
      launch();
    },
    async stop() {
      serving?.kill('SIGTERM');
      await ws.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/**
 * A throwaway org + pool serving the cached test model, with a real CLI node enrolled in it and running. Slow parts
 * (model download from Hugging Face, upload, the node fetching and loading it) happen here and in `ready()`.
 */
export async function startServingNode(): Promise<ServingNode> {
  const file = await ensureModelFile(); // cached between runs, downloaded when missing
  const ws = await createWorkspace();
  const model = await ws.serveModel(MODEL, file);
  const { secret } = await ws.apiKey();
  return runNode(ws, model.id, secret, (key) => chat(key, { max_tokens: 1 }));
}

/**
 * A throwaway org whose only pool serves a REAL embedding model (`E2E_EMBEDDING_MODEL_URL`, mirrored by the control
 * plane from Hugging Face) on a CLI node. Call only when `embeddingModelUrl` is set.
 */
export async function startEmbeddingNode(): Promise<ServingNode> {
  if (!embeddingModelUrl) throw new Error('E2E_EMBEDDING_MODEL_URL is not set');
  const ws = await createWorkspace();
  const added = await ws.cp.addModelFromUrl(ws.org.id, EMBED_MODEL, embeddingModelUrl, 'embedding');
  await ws.cp.waitModelReady(ws.org.id, added.id);
  await ws.cp.assignModel(ws.org.id, ws.pool.id, added.id);
  const { secret } = await ws.apiKey();
  return runNode(ws, added.id, secret, (key) => embed(key));
}

/** The name of the model of the placeholder embedding pool (`addPlaceholderEmbeddingPool`). */
export const PLACEHOLDER_EMBED_MODEL = 'e2e-placeholder-embedding';

/** The entries of `GET /v1/models` for a key. */
export async function listModels(
  key: string,
): Promise<{ id: string; kind?: 'chat' | 'embedding' }[]> {
  const res = await fetch(`${gatewayUrl}/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { id: string; kind?: 'chat' | 'embedding' }[] }).data;
}

/**
 * A second pool in the node's organisation that serves an embedding model nobody can load (a few placeholder bytes).
 * Enough for everything the gateway decides from the model alone: its kind in `/v1/models`, 400 on the wrong
 * endpoint, 503 without a node. Resolves once the gateway has the pool in its cache (its config feed is asynchronous).
 */
export async function addPlaceholderEmbeddingPool(node: ServingNode): Promise<{ poolId: string }> {
  const { ws, secret } = node;
  const placeholder = placeholderModel();
  try {
    const pool = await ws.cp.createPool(ws.org.id, 'e2e-embedding-pool');
    const model = await ws.cp.uploadModel(
      ws.org.id,
      PLACEHOLDER_EMBED_MODEL,
      placeholder.file,
      'embedding',
    );
    await ws.cp.assignModel(ws.org.id, pool.id, model.id);
    await waitFor(
      'the gateway to list the embedding model',
      async () =>
        (await listModels(secret)).some((m) => m.id === PLACEHOLDER_EMBED_MODEL) ? true : undefined,
      60_000,
      1_000,
    );
    return { poolId: pool.id };
  } finally {
    placeholder.remove();
  }
}
