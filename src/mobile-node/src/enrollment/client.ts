import i18n from 'i18next';
import {
  fingerprint,
  fromB64,
  open,
  parseCode,
  proofOfPossession,
  seal,
  startPake,
  toB64,
} from './crypto';
import type { Identity } from './identity';
import { randomBytes } from './random';

export type EnrollErrorKind =
  | 'invalidCode' // unknown, expired or used up (the server never says which)
  | 'rateLimited'
  | 'conflict' // this device key is already registered
  | 'untrustedServer' // the server could not prove it knows the code
  | 'network'
  | 'server';

export class EnrollError extends Error {
  constructor(
    readonly kind: EnrollErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

export interface DeviceInfo {
  name?: string;
  platform?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  cpuCores?: number;
  memoryTotalMb?: number;
}

export interface EnrollmentResult {
  nodeId: string;
  fingerprint: string;
  /** False while the pool requires admin approval. */
  approved: boolean;
  /** The gateway identity to pin; null when the platform has none configured yet. */
  gateway: { publicKey: string; url: string } | null;
  orgName?: string;
  poolName?: string;
}

async function post(baseUrl: string, path: string, body: object): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Accept-Language': i18n.language || 'en' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EnrollError('network');
  }
  if (res.status === 404) throw new EnrollError('invalidCode');
  if (res.status === 429) throw new EnrollError('rateLimited');
  if (res.status === 409) throw new EnrollError('conflict');
  if (!res.ok) throw new EnrollError('server', `HTTP ${res.status}`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new EnrollError('server', 'bad response');
  }
}

/**
 * Enrolls this device with the control plane (never the gateway): two PAKE rounds over HTTPS. The typed code
 * authenticates both sides, so a wrong or fake server cannot complete the exchange; the device then registers its
 * own public key (proving it holds the private key) and learns the gateway identity to pin.
 */
export async function enroll(params: {
  baseUrl: string;
  code: string;
  identity: Identity;
  device: DeviceInfo;
}): Promise<EnrollmentResult> {
  const parsed = parseCode(params.code);
  if (!parsed) throw new EnrollError('invalidCode');
  const sid = randomBytes(16);
  const pake = startPake(parsed.secret, sid);

  const started = await post(params.baseUrl, '/enroll/start', {
    lookupId: parsed.lookupId,
    sid: toB64(sid),
    share: toB64(pake.share),
  });
  if (typeof started.share !== 'string') throw new EnrollError('server', 'bad response');
  let isk: Uint8Array;
  try {
    isk = pake.finish(fromB64(started.share));
  } catch {
    throw new EnrollError('untrustedServer');
  }

  const request = {
    publicKey: params.identity.publicKeyB64,
    signature: toB64(proofOfPossession(params.identity.privateKey, sid)),
    ...params.device,
  };
  const completed = await post(params.baseUrl, '/enroll/complete', {
    lookupId: parsed.lookupId,
    sealed: toB64(
      seal(isk, sid, 'request', new TextEncoder().encode(JSON.stringify(request)), randomBytes(12)),
    ),
  });
  if (typeof completed.sealed !== 'string') throw new EnrollError('server', 'bad response');

  // Only a server that derived the same key (so knows the code) can produce a message that opens.
  const plain = open(isk, sid, 'response', fromB64(completed.sealed));
  if (!plain) throw new EnrollError('untrustedServer');
  const r = JSON.parse(new TextDecoder().decode(plain)) as {
    nodeId?: string;
    fingerprint?: string;
    approved?: boolean;
    gateway?: { publicKey: string; url: string } | null;
    orgName?: string;
    poolName?: string;
  };
  if (typeof r.nodeId !== 'string' || typeof r.approved !== 'boolean') {
    throw new EnrollError('server', 'bad response');
  }
  // The server computes the fingerprint too; trust our own calculation when they disagree.
  return {
    nodeId: r.nodeId,
    fingerprint: fingerprint(params.identity.publicKey),
    approved: r.approved,
    gateway: r.gateway ?? null,
    orgName: r.orgName,
    poolName: r.poolName,
  };
}
