import { formatCodeInput, parseCode } from './crypto';

/**
 * The join code carried by the link the web app opens: `https://web-node.<domain>/#code=XXXX-XXXXXX`. It is in the
 * fragment on purpose: a fragment is never sent to any server, so the code stays out of access logs and `Referer`.
 */
export function codeFromHash(hash: string): string {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('code');
  return raw && parseCode(raw) ? formatCodeInput(raw) : '';
}
