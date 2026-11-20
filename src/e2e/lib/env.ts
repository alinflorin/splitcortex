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
