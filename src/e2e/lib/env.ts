import 'dotenv/config';

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (see src/e2e/.env.example)`);
  return v;
}

const list = (name: string) =>
  need(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const baseUrl = () =>
  (process.env.BASE_URL?.trim() || 'https://local.splitcortex.com').replace(/\/+$/, '');
const host = () => new URL(baseUrl()).hostname;

/** The web node lives next to the web app: `web-node.<host>`; Dex at `dex.<host>`. */
export const webNodeUrl = () => `https://web-node.${host()}`;
export const dexUrl = () => `https://dex.${host()}`;
export const isLocal = () => host().endsWith('local.splitcortex.com') || host() === 'localhost';

/** Fixed test models (small, so the slowest node can load them). */
export const CHAT_MODEL = {
  name: 'e2e-chat-smollm2',
  url: 'https://huggingface.co/litert-community/SmolLM2-135M-Instruct/resolve/main/SmolLM2_135M_Instruct.litertlm',
};
export const EMBEDDING_MODEL = {
  name: 'e2e-embedding-gemma',
  url: 'https://huggingface.co/kasimtmc/embeddinggemma-litertlm/resolve/main/embeddinggemma_300m.litertlm',
};

/** E2E_EMAILS / E2E_PASSWORDS: same length, same order. */
export function users(): { email: string; password: string }[] {
  const emails = list('E2E_EMAILS');
  const passwords = list('E2E_PASSWORDS');
  if (emails.length !== passwords.length) {
    throw new Error('E2E_EMAILS and E2E_PASSWORDS must have the same number of entries');
  }
  return emails.map((email, i) => ({ email, password: passwords[i]! }));
}

export const optional = (name: string) => process.env[name]?.trim() || undefined;
export const authFile = (index: number) => `.auth/user${index + 1}.json`;

/**
 * The node types under test; each has pools and an API key of its own, so they can run at the same time. CI runs one
 * type per job with E2E_NODE_TYPES (`none` for the jobs without devices); the default is all of them.
 */
export const NODE_TYPES = ['web', 'cli', 'android'] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export function nodeTypes(): NodeType[] {
  const wanted = optional('E2E_NODE_TYPES')
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!wanted) return [...NODE_TYPES];
  if (wanted.length === 1 && wanted[0] === 'none') return [];
  const unknown = wanted.filter((t) => !(NODE_TYPES as readonly string[]).includes(t));
  if (unknown.length) throw new Error(`E2E_NODE_TYPES: unknown ${unknown.join(', ')}`);
  return wanted as NodeType[];
}
