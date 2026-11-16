import { nodeAuthorization } from '../protocol/handshake';
import { getOrCreateIdentity } from './identity';
import { loadEnrollment, saveEnrollment, type StoredEnrollment } from './store';

/**
 * Asks the control plane who this device is (organisation, pool, name) and stores it. Works once the device is approved
 * (device routes reject unapproved ones); a success also proves it is approved. Best effort: offline or rejected, the
 * stored values stay.
 */
export async function refreshEnrollmentInfo(
  doFetch: typeof fetch = fetch,
): Promise<StoredEnrollment | null> {
  const e = await loadEnrollment();
  if (!e) return null;
  try {
    const url = `${e.enrollmentUrl.replace(/\/+$/, '')}/node/me`;
    const identity = await getOrCreateIdentity();
    const res = await doFetch(url, {
      headers: {
        Authorization: nodeAuthorization(
          e.nodeId,
          identity.privateKey,
          'GET',
          new URL(url).pathname,
        ),
      },
    });
    if (!res.ok) return e;
    const me = (await res.json()) as {
      name?: string;
      orgName?: string;
      poolName?: string;
      approved?: boolean;
    };
    const next: StoredEnrollment = {
      ...e,
      orgName: me.orgName ?? e.orgName,
      poolName: me.poolName ?? e.poolName,
      deviceName: me.name ?? e.deviceName,
      approved: me.approved ?? e.approved,
    };
    await saveEnrollment(next);
    return next;
  } catch {
    return e;
  }
}
