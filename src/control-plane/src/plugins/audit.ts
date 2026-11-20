import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { recordAudit } from '../db/audit';

/**
 * Audit trail of API mutations (decided: every mutation of an organisation is logged, requests that only read are not).
 * One hook records them from a table, so a handler cannot forget to. A route that mutates under `/organisations` and is
 * neither listed here nor in `NOT_AUDITED` makes the app fail at startup: a new endpoint must decide.
 *
 * Recorded: success (2xx) and `denied` (403: the caller is a member with too low a role; non-members get 404 and are
 * not logged, so existence of an organisation is not revealed through the log). The row is written after the response
 * is built, not in the handler's transaction.
 */
interface Rule {
  action: string;
  entityType: string;
  /** Route param holding the entity id; otherwise the `id` of the response body. */
  entityParam?: string;
  /** Extra non-secret facts from the request body (a PATCH records what it changed). */
  meta?: (body: Record<string, unknown>) => Record<string, unknown>;
}

const changed = (body: Record<string, unknown>) => ({ changes: body });

const RULES: Record<string, Rule> = {
  'POST /organisations': { action: 'organisation.create', entityType: 'organisation' },
  'PATCH /organisations/:orgId': {
    action: 'organisation.update',
    entityType: 'organisation',
    entityParam: 'orgId',
    meta: changed,
  },
  'POST /organisations/:orgId/members': {
    action: 'member.add',
    entityType: 'member',
    meta: (b) => ({ email: b.email, role: b.role }),
  },
  'PATCH /organisations/:orgId/members/:email': {
    action: 'member.update',
    entityType: 'member',
    entityParam: 'email',
    meta: changed,
  },
  'DELETE /organisations/:orgId/members/:email': {
    action: 'member.remove',
    entityType: 'member',
    entityParam: 'email',
  },
  'POST /organisations/:orgId/pools': { action: 'pool.create', entityType: 'pool' },
  'PATCH /organisations/:orgId/pools/:poolId': {
    action: 'pool.update',
    entityType: 'pool',
    entityParam: 'poolId',
    meta: changed,
  },
  'DELETE /organisations/:orgId/pools/:poolId': {
    action: 'pool.delete',
    entityType: 'pool',
    entityParam: 'poolId',
  },
  'PATCH /organisations/:orgId/nodes/:nodeId': {
    action: 'node.update',
    entityType: 'node',
    entityParam: 'nodeId',
    meta: changed,
  },
  'DELETE /organisations/:orgId/nodes/:nodeId': {
    action: 'node.delete',
    entityType: 'node',
    entityParam: 'nodeId',
  },
  'POST /organisations/:orgId/models/from-url': { action: 'model.create', entityType: 'model' },
  'POST /organisations/:orgId/models/uploads': {
    action: 'model.upload_start',
    entityType: 'model',
  },
  'POST /organisations/:orgId/models/:modelId/complete': {
    action: 'model.upload_complete',
    entityType: 'model',
    entityParam: 'modelId',
  },
  'POST /organisations/:orgId/models/:modelId/retry': {
    action: 'model.retry',
    entityType: 'model',
    entityParam: 'modelId',
  },
  'DELETE /organisations/:orgId/models/:modelId': {
    action: 'model.delete',
    entityType: 'model',
    entityParam: 'modelId',
  },
  'PUT /organisations/:orgId/pools/:poolId/models/:modelId': {
    action: 'pool.model_assign',
    entityType: 'pool',
    entityParam: 'poolId',
  },
  'DELETE /organisations/:orgId/pools/:poolId/models/:modelId': {
    action: 'pool.model_unassign',
    entityType: 'pool',
    entityParam: 'poolId',
  },
  'POST /organisations/:orgId/api-keys': { action: 'api_key.create', entityType: 'api_key' },
  'PATCH /organisations/:orgId/api-keys/:keyId': {
    action: 'api_key.update',
    entityType: 'api_key',
    entityParam: 'keyId',
    meta: changed,
  },
  'DELETE /organisations/:orgId/api-keys/:keyId': {
    action: 'api_key.delete',
    entityType: 'api_key',
    entityParam: 'keyId',
  },
  'POST /organisations/:orgId/pools/:poolId/benchmarks': {
    action: 'benchmark.run',
    entityType: 'benchmark',
  },
  'DELETE /organisations/:orgId/pools/:poolId/benchmarks/:benchmarkId': {
    action: 'benchmark.delete',
    entityType: 'benchmark',
    entityParam: 'benchmarkId',
  },
  'POST /organisations/:orgId/pools/:poolId/enrollments': {
    action: 'enrollment.create',
    entityType: 'enrollment',
  },
  'POST /organisations/:orgId/pools/:poolId/enrollments/bulk': {
    action: 'enrollment.create_bulk',
    entityType: 'pool',
    entityParam: 'poolId',
    meta: (b) => ({ count: b.count }),
  },
  'DELETE /organisations/:orgId/enrollments/:enrollmentId': {
    action: 'enrollment.delete',
    entityType: 'enrollment',
    entityParam: 'enrollmentId',
  },
};

/** Mutating routes that are deliberately not logged here, with the reason. */
const NOT_AUDITED: Record<string, string> = {
  // The audit rows are deleted with the organisation (cascade), so there is nowhere to write.
  'DELETE /organisations/:orgId': 'rows go with the organisation',
  // One call per upload part: noise. The upload is logged at start and at completion.
  'PUT /organisations/:orgId/models/:modelId/parts/:partNumber': 'per-part noise',
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ruleKey = (method: string, url: string) =>
  `${method} ${url.replace(/^\/api/, '').replace(/\/$/, '')}`;

export default fp<{ db: Db }>(async (app, { db }) => {
  app.addHook('onRoute', (route) => {
    if (!route.url.includes('/organisations')) return;
    for (const method of [route.method].flat()) {
      if (!MUTATING.has(method)) continue;
      const key = ruleKey(method, route.url);
      if (!(key in RULES) && !(key in NOT_AUDITED))
        throw new Error(
          `Mutating route "${key}" must be added to plugins/audit.ts (RULES or NOT_AUDITED)`,
        );
    }
  });

  app.addHook('onSend', async (req: FastifyRequest, reply, payload) => {
    const rule = RULES[ruleKey(req.method, req.routeOptions.url ?? '')];
    if (!rule || !req.user) return payload;
    const status = reply.statusCode;
    if ((status < 200 || status >= 300) && status !== 403) return payload;
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, unknown>;

    let created: Record<string, unknown> = {};
    if (status < 300 && typeof payload === 'string' && payload.startsWith('{')) {
      try {
        created = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
    }
    const orgId = params.orgId ?? (typeof created.id === 'string' ? created.id : undefined);
    if (!orgId || !UUID.test(orgId)) return payload;
    // An API key is created as { key: { id }, secret }: the id is one level down.
    const nested = created.key as { id?: unknown } | undefined;
    const entityId =
      (rule.entityParam ? params[rule.entityParam] : undefined) ??
      (typeof created.id === 'string' ? created.id : undefined) ??
      (typeof nested?.id === 'string' ? nested.id : undefined) ??
      (typeof body.email === 'string' ? body.email : undefined);

    const metadata: Record<string, unknown> = { ...rule.meta?.(body) };
    if (params.poolId && rule.entityType !== 'pool') metadata.poolId = params.poolId;
    if (rule.action.startsWith('pool.model_') && params.modelId) metadata.modelId = params.modelId;
    try {
      await recordAudit(db, {
        orgId,
        actorType: 'user',
        actorId: req.user.email,
        action: rule.action,
        entityType: rule.entityType,
        entityId: entityId ?? null,
        outcome: status === 403 ? 'denied' : 'success',
        ip: req.ip,
        metadata: Object.keys(metadata).length ? metadata : null,
      });
    } catch (err) {
      // The change already happened; losing the audit row must be loud but must not turn it into a 500.
      req.log.error({ err }, 'audit log write failed');
    }
    return payload;
  });
});
