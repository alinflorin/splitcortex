import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/** What `setup` created, for the specs after it (separate files, one worker, same machine). */
export interface NodePools {
  chatPoolId: string;
  embedPoolId: string;
  /** Scoped to these two pools, so the model name picks the pool unambiguously. */
  apiKey: string;
  apiKeyId: string;
}

export interface RunState {
  orgId: string;
  orgName: string;
  chatPoolId: string;
  embedPoolId: string;
  apiKey: string;
  apiKeyId: string;
  /** Pools and key per node type under test (see `nodeTypes()`). */
  nodes: Partial<Record<string, NodePools>>;
}

const FILE = '.state/run.json';

export function saveState(state: RunState) {
  mkdirSync('.state', { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

export function loadState(): RunState {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as RunState;
  } catch {
    throw new Error('No run state: the setup project did not complete');
  }
}
