import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Fixed-window per-IP limiter for unauthenticated routes. In memory, so per instance (the ingress has its own
 * coarse limit too); the real brake on enrollment guessing is the attempt limit stored in the database.
 */
export function ipRateLimit(app: FastifyInstance, max: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (req: FastifyRequest) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const h = hits.get(req.ip);
    if (!h || h.resetAt <= now) {
      hits.set(req.ip, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (++h.count > max) throw app.httpErrors.tooManyRequests('errors.tooManyRequests');
  };
}
