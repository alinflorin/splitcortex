import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, waitFor, type Workspace } from '../api.ts';
import { apiUrl } from '../env.ts';
import { chat } from '../serving-node.ts';
import { DEFAULT_SIM, enrollDevice, SimNode, type SimOptions } from './fake-node.ts';

export const PERF_MODEL = 'perf-sim-model';

export interface Fleet {
  ws: Workspace;
  secret: string;
  nodes: SimNode[];
  /** Total pieces / requests the simulated nodes served (what the gateway's metering must agree with). */
  totals(): { requests: number; pieces: number };
  stop(): Promise<void>;
}

/**
 * A throwaway org + pool with `count` simulated nodes online and serving a placeholder model (the nodes never download
 * it, so a few bytes will do). Resolves when the gateway answers a request through the pool.
 */
export async function startFleet(count: number, sim: SimOptions = DEFAULT_SIM): Promise<Fleet> {
  const dir = mkdtempSync(join(tmpdir(), 'splitcortex-perf-'));
  const path = join(dir, 'placeholder.litertlm');
  writeFileSync(path, 'placeholder model for the perf suite');
  const ws = await createWorkspace();
  const nodes: SimNode[] = [];
  try {
    await ws.serveModel(PERF_MODEL, {
      path,
      fileName: 'placeholder.litertlm',
      sizeBytes: statSync(path).size,
    });
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
        const r = await chat(secret, { model: PERF_MODEL, max_tokens: 1 });
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
