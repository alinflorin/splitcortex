import { createPublicKey, verify as edVerify } from 'node:crypto';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { nodes } from '../db/schema';

export interface AuthNode {
  id: string;
  orgId: string;
  poolId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    node: AuthNode | null;
  }
  interface FastifyInstance {
    /** onRequest hook for device-facing routes: verifies the node's signature (proof of possession of its enrolled key). */
    authenticateNode: (req: FastifyRequest) => Promise<void>;
  }
}

/** Domain separation: a signature made for this API is never valid for enrollment or the gateway. */
export const NODE_REQUEST_LABEL = 'splitcortex-node-request-v1';
/** Accepted clock skew between a device and the server. */
export const NODE_REQUEST_SKEW_MS = 60_000;

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** The bytes a node signs: `label \n METHOD \n path (without query) \n unix-seconds`. */
export const nodeRequestMessage = (method: string, path: string, timestamp: number) =>
  Buffer.from(`${NODE_REQUEST_LABEL}\n${method.toUpperCase()}\n${path}\n${timestamp}`);

/**
 * Device-facing authentication. Header: `Authorization: Node <nodeId>.<unixSeconds>.<signature>` where signature is the
 * base64url Ed25519 signature over {@link nodeRequestMessage} by the key registered at enrollment. Nothing secret is
 * ever sent, so revoking a node (deleting its row) or leaving it unapproved takes effect immediately. A captured request
 * can only be replayed against the same method and path within the skew window, over TLS. Every failure is the same
 * generic 401.
 */
export default fp<{ db: Db }>(async (app, { db }) => {
  app.decorateRequest('node', null);

  app.decorate('authenticateNode', async (req: FastifyRequest) => {
    const deny = () => app.httpErrors.unauthorized('errors.invalidNodeCredentials');
    const header = req.headers.authorization;
    if (!header?.startsWith('Node ')) throw deny();
    const [nodeId, ts, sig, extra] = header.slice(5).split('.');
    if (!nodeId || !ts || !sig || extra !== undefined || !/^\d{1,12}$/.test(ts)) throw deny();
    const seconds = Number(ts);
    if (Math.abs(Date.now() - seconds * 1000) > NODE_REQUEST_SKEW_MS) throw deny();
    if (!/^[0-9a-f-]{36}$/i.test(nodeId)) throw deny();

    const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!node || !node.approved) throw deny();

    const publicKey = Buffer.from(node.publicKey, 'base64url');
    const signature = Buffer.from(sig, 'base64url');
    if (publicKey.length !== 32 || signature.length !== 64) throw deny();
    const path = req.url.split('?')[0]!;
    let ok = false;
    try {
      const key = createPublicKey({
        key: Buffer.concat([ED25519_SPKI, publicKey]),
        format: 'der',
        type: 'spki',
      });
      ok = edVerify(null, nodeRequestMessage(req.method, path, seconds), key, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw deny();
    req.node = { id: node.id, orgId: node.orgId, poolId: node.poolId };
  });
});
