import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, waitFor, type Workspace } from '../api.ts';
import { apiUrl } from '../env.ts';
import { chat, embed } from '../serving-node.ts';
import { DEFAULT_SIM, enrollDevice, SimNode, type SimOptions } from './fake-node.ts';

export const PERF_MODEL = 'perf-sim-model';
export const PERF_EMBED_MODEL = 'perf-sim-embedding';

export interface Fleet {
  ws: Workspace;
  secret: string;
  nodes: SimNode[];
  /** Total pieces / requests the simulated nodes served (what the gateway's metering must agree with). */
  totals(): { requests: number; pieces: number; embeddedTokens: number };
  stop(): Promise<void>;
}

/**
 * A throwaway org + pool with `count` simulated nodes online and serving a placeholder model (the nodes never download
 * it, so a few bytes will do). Resolves when the gateway answers a request through the pool.
 */
export async function startFleet(
  count: number,
  sim: SimOptions = DEFAULT_SIM,
  /** `embedding`: the pool serves an embedding model (`PERF_EMBED_MODEL`, `/v1/embeddings`) instead of the chat one. */
  kind: 'chat' | 'embedding' = 'chat',
): Promise<Fleet> {
  const model = kind === 'embedding' ? PERF_EMBED_MODEL : PERF_MODEL;
  const dir = mkdtempSync(join(tmpdir(), 'splitcortex-perf-'));
  const path = join(dir, 'placeholder.litertlm');
  writeFileSync(path, 'placeholder model for the perf suite');
  const ws = await createWorkspace();
  const nodes: SimNode[] = [];
  try {
    await ws.serveModel(
      model,
      { path, fileName: 'placeholder.litertlm', sizeBytes: statSync(path).size },
      kind,
    );
    const { secret } = await ws.apiKey();
    // The enrollment endpoints are rate limited per IP: a few at a time.
    let next = 0;
    const worker = async () => {
      while (next < count) {
        const i = next++;
        const enrolled = await enrollDevice(apiUrl, await ws.code(), `sim-${i}`);
        const node = new SimNode(enrolled, sim);
        await node.connected;
        nodes.push(node);
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, count) }, worker));
    await waitFor(
      'the gateway to serve the placeholder model',
      async () => {
        const r =
          kind === 'embedding'
            ? await embed(secret, { model, input: 'ready?' })
            : await chat(secret, { model, max_tokens: 1 });
        await r.arrayBuffer();
        return r.status === 200 ? true : undefined;
      },
      60_000,
      1_000,
    );
    return {
      ws,
      secret,
      nodes,
      totals: () => ({
        requests: nodes.reduce((n, x) => n + x.served, 0),
        pieces: nodes.reduce((n, x) => n + x.pieces, 0),
        embeddedTokens: nodes.reduce((n, x) => n + x.embeddedTokens, 0),
      }),
      stop: async () => {
        nodes.forEach((n) => n.kill());
        await ws.cleanup();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    nodes.forEach((n) => n.kill());
    await ws.cleanup().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
