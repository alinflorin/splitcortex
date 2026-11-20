import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BulkEnrollmentSchema,
  CreatedBulkEnrollmentsSchema,
  CreatedEnrollmentSchema,
  EnrollCompleteResponseSchema,
  EnrollCompleteSchema,
  EnrollRequestPlainSchema,
  EnrollResponsePlainSchema,
  EnrollStartResponseSchema,
  EnrollStartSchema,
  EnrollmentParamsSchema,
  EnrollmentSchema,
  ErrorSchema,
  PoolNodesParamsSchema,
  type EnrollResponsePlain,
  type CreatedEnrollmentDto,
  type EnrollmentDto,
} from '../dto';
import { requireOrgRole } from '../access';
import { recordAudit } from '../db/audit';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { enrollments, nodes, organisations, pools } from '../db/schema';
import {
  b64,
  fingerprint,
  formatCode,
  generateCode,
  open,
  seal,
  serverPake,
  unb64,
  verifyProofOfPossession,
} from '../enrollment/crypto';
import { ipRateLimit } from '../plugins/rate-limit';

/** How long a code stays valid. */
export const ENROLLMENT_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

export interface GatewayIdentity {
  /** The gateway's public key (the device pins it) and the wss URL nodes connect to. */
  publicKey: string;
  url: string;
}

const toDto = (e: typeof enrollments.$inferSelect): EnrollmentDto => ({
  id: e.id,
  poolId: e.poolId,
  createdBy: e.createdBy,
  expiresAt: e.expiresAt.toISOString(),
  attempts: e.attempts,
  maxAttempts: e.maxAttempts,
  createdAt: e.createdAt.toISOString(),
});

export const enrollmentRoutes: FastifyPluginAsyncZod<{
  db: Db;
  gateway: GatewayIdentity | null;
}> = async (app, { db, gateway }) => {
  // --- Admin side (web app) ---

  /** Creates `count` codes for a pool of the organisation; the pool must exist (404 otherwise). */
  async function issueCodes(orgId: string, poolId: string, email: string, count: number) {
    const [pool] = await db
      .select({ id: pools.id })
      .from(pools)
      .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
    if (!pool) throw app.httpErrors.notFound('errors.poolNotFound');
    // Expired codes free their lookup id.
    await db.delete(enrollments).where(lte(enrollments.expiresAt, new Date()));
    const created: CreatedEnrollmentDto[] = [];
    try {
      while (created.length < count) {
        let row: typeof enrollments.$inferSelect | undefined;
        let code = '';
        for (let i = 0; i < 20 && !row; i++) {
          const { lookupId, secret } = generateCode();
          [row] = await db
            .insert(enrollments)
            .values({
              orgId,
              poolId,
              createdBy: email,
              lookupId,
              secret,
              expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
              maxAttempts: MAX_ATTEMPTS,
            })
            .onConflictDoNothing({ target: enrollments.lookupId })
            .returning();
          code = formatCode(lookupId, secret);
        }
        if (!row) throw app.httpErrors.serviceUnavailable('errors.codeAllocation');
        created.push({ enrollment: toDto(row), code });
      }
    } catch (err) {
      // All or nothing: do not leave live codes behind that nobody received.
      if (created.length > 0)
        await db.delete(enrollments).where(
          inArray(
            enrollments.id,
            created.map((c) => c.enrollment.id),
          ),
        );
      throw err;
    }
    return created;
  }

  app.post(
    '/organisations/:orgId/pools/:poolId/enrollments',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['enrollment'],
        summary:
          'Create an enrollment code for a pool (admin or owner). The code is returned once, valid ~10 minutes, single use.',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        response: {
          201: CreatedEnrollmentSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const [pool] = await db
        .select({ id: pools.id })
        .from(pools)
        .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
      if (!pool) throw app.httpErrors.notFound('errors.poolNotFound');
      const [created] = await issueCodes(orgId, poolId, req.user!.email, 1);
      return reply.code(201).send(created!);
    },
  );

  app.post(
    '/organisations/:orgId/pools/:poolId/enrollments/bulk',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['enrollment'],
        summary:
          'Create several enrollment codes for a pool at once (admin or owner), one per device. Same rules as a single code: returned once, valid ~10 minutes, single use.',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        body: BulkEnrollmentSchema,
        response: {
          201: CreatedBulkEnrollmentsSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const items = await issueCodes(orgId, poolId, req.user!.email, req.body.count);
      return reply.code(201).send({ items });
    },
  );

  app.get(
    '/organisations/:orgId/pools/:poolId/enrollments',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['enrollment'],
        summary: 'Active (unexpired) enrollments of a pool, without their codes (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        response: {
          200: z.array(EnrollmentSchema),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const rows = await db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.orgId, orgId),
            eq(enrollments.poolId, poolId),
            gt(enrollments.expiresAt, new Date()),
          ),
        )
        .orderBy(enrollments.createdAt);
      return rows.map(toDto);
    },
  );

  app.delete(
    '/organisations/:orgId/enrollments/:enrollmentId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['enrollment'],
        summary: 'Cancel an enrollment code (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: EnrollmentParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, enrollmentId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const deleted = await db
        .delete(enrollments)
        .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.orgId, orgId)))
        .returning({ id: enrollments.id });
      if (deleted.length === 0) throw app.httpErrors.notFound('errors.enrollmentNotFound');
      return reply.code(204).send(null);
    },
  );

  // --- Device side: two PAKE rounds over plain HTTPS. The code reveals nothing about the org or pool, and every
  // failure looks the same. ---

  const limit = ipRateLimit(app, 30);
  const invalid = () => app.httpErrors.notFound('errors.invalidCode');

  app.post(
    '/enroll/start',
    {
      onRequest: limit,
      schema: {
        tags: ['enrollment'],
        summary:
          'Device, round 1: send the first 4 characters of the code, a session id and the CPace share; get the server share. Counts as one guess.',
        body: EnrollStartSchema,
        response: {
          200: EnrollStartResponseSchema,
          404: ErrorSchema,
          429: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { lookupId, share } = req.body;
      let deviceShare: Uint8Array;
      let sid: Uint8Array;
      try {
        deviceShare = unb64(share);
        sid = unb64(req.body.sid);
        if (deviceShare.length !== 32 || sid.length !== 16) throw new Error('bad input');
      } catch {
        throw invalid();
      }
      // Claim one attempt atomically; this also enforces the limit and the expiry.
      const [row] = await db
        .update(enrollments)
        .set({ attempts: sql`${enrollments.attempts} + 1` })
        .where(
          and(
            eq(enrollments.lookupId, lookupId),
            gt(enrollments.expiresAt, new Date()),
            lt(enrollments.attempts, enrollments.maxAttempts),
          ),
        )
        .returning({ id: enrollments.id, secret: enrollments.secret });
      if (!row) throw invalid();
      let server: ReturnType<typeof serverPake>;
      try {
        server = serverPake(row.secret, sid, deviceShare);
      } catch {
        throw invalid(); // not a valid group element
      }
      await db
        .update(enrollments)
        .set({ sessionSid: b64(sid), sessionIsk: b64(server.isk) })
        .where(eq(enrollments.id, row.id));
      return { share: b64(server.share) };
    },
  );

  app.post(
    '/enroll/complete',
    {
      onRequest: limit,
      schema: {
        tags: ['enrollment'],
        summary:
          'Device, round 2: the device public key and info, sealed with the PAKE key. Registers the node and consumes the code.',
        body: EnrollCompleteSchema,
        response: {
          200: EnrollCompleteResponseSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          429: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { lookupId, sealed } = req.body;
      // Take the session (one complete per start): a second try needs a new start, which is a counted guess.
      const taken = await db.transaction(async (tx) => {
        const [e] = await tx
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.lookupId, lookupId), gt(enrollments.expiresAt, new Date())))
          .for('update');
        if (!e?.sessionSid || !e.sessionIsk) return null;
        await tx
          .update(enrollments)
          .set({ sessionSid: null, sessionIsk: null })
          .where(eq(enrollments.id, e.id));
        return { ...e, sessionSid: e.sessionSid, sessionIsk: e.sessionIsk };
      });
      if (!taken) throw invalid();

      const sid = unb64(taken.sessionSid);
      const isk = unb64(taken.sessionIsk);
      const fail = async () => {
        if (taken.attempts >= taken.maxAttempts) {
          await db.delete(enrollments).where(eq(enrollments.id, taken.id));
        }
        return invalid();
      };

      const plainBytes = open(isk, sid, 'request', unb64(sealed));
      if (!plainBytes) throw await fail(); // wrong code (different PAKE key) or tampering

      const parsed = EnrollRequestPlainSchema.safeParse(
        (() => {
          try {
            return JSON.parse(new TextDecoder().decode(plainBytes));
          } catch {
            return null;
          }
        })(),
      );
      if (!parsed.success) throw await fail();
      const req2 = parsed.data;
      const publicKey = unb64(req2.publicKey);
      if (!verifyProofOfPossession(publicKey, sid, unb64(req2.signature))) throw await fail();

      const fp = fingerprint(publicKey);
      const result = await db.transaction(async (tx) => {
        const [pool] = await tx
          .select({ requireApproval: pools.requireApproval, name: pools.name })
          .from(pools)
          .where(eq(pools.id, taken.poolId));
        if (!pool) return { error: 'gone' as const };
        const [dup] = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(eq(nodes.publicKey, req2.publicKey));
        if (dup) return { error: 'duplicate' as const };
        const approved = !pool.requireApproval;
        const [node] = await tx
          .insert(nodes)
          .values({
            orgId: taken.orgId,
            poolId: taken.poolId,
            name: req2.name ?? req2.deviceModel ?? 'Device',
            publicKey: req2.publicKey,
            fingerprint: fp,
            approved,
            platform: req2.platform,
            deviceModel: req2.deviceModel,
            osVersion: req2.osVersion,
            appVersion: req2.appVersion,
            cpuCores: req2.cpuCores,
            memoryTotalMb: req2.memoryTotalMb,
          })
          .returning({ id: nodes.id });
        await tx.delete(enrollments).where(eq(enrollments.id, taken.id));
        await recordAudit(tx, {
          orgId: taken.orgId,
          actorType: 'node',
          actorId: node!.id,
          action: 'node.enroll',
          entityType: 'node',
          entityId: node!.id,
          ip: req.ip,
          metadata: { poolId: taken.poolId, approved, platform: req2.platform },
        });
        const seq = await recordConfigChange(tx, {
          entityType: 'node',
          entityId: node!.id,
          orgId: taken.orgId,
        });
        const [org] = await tx
          .select({ name: organisations.name })
          .from(organisations)
          .where(eq(organisations.id, taken.orgId));
        return {
          nodeId: node!.id,
          approved,
          seq,
          orgName: org?.name ?? '',
          poolName: pool.name,
        };
      });
      if ('error' in result) {
        if (result.error === 'duplicate') {
          throw app.httpErrors.conflict('errors.deviceKeyRegistered');
        }
        throw invalid();
      }
      await notifyConfigChange(db, result.seq);

      const response: EnrollResponsePlain = EnrollResponsePlainSchema.parse({
        nodeId: result.nodeId,
        fingerprint: fp,
        approved: result.approved,
        gateway,
        orgName: result.orgName,
        poolName: result.poolName,
      });
      return {
        sealed: b64(seal(isk, sid, 'response', new TextEncoder().encode(JSON.stringify(response)))),
      };
    },
  );
};
