import { formatCodeInput, parseCode } from './crypto';

/**
 * The join code carried by the link the web app opens: `https://web-node.<domain>/#code=XXXX-XXXXXX`. It is in the
 * fragment on purpose: a fragment is never sent to any server, so the code stays out of access logs and `Referer`.
 */
export function codeFromHash(hash: string): string {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('code');
  return raw && parseCode(raw) ? formatCodeInput(raw) : '';
}

/**
 * The join code in what a QR carries: the app's deep link `splitcortex://enroll?url=…&code=…` (only the code is used;
 * this page always enrolls against its own origin), or a bare code. Empty when it is neither.
 */
export function codeFromScan(data: string): string {
  const text = data.trim();
  const m = /^splitcortex:\/\/enroll\?(.*)$/i.exec(text);
  const raw = m ? new URLSearchParams(m[1]).get('code') : text;
  return raw && parseCode(raw) ? formatCodeInput(raw) : '';
}
