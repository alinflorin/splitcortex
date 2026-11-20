import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import { z } from 'zod';
import { useFreshToken } from '../auth/useFreshToken';
import { ApiError, putPart, request, requestBlob } from './client';
import type { Method } from './client';
import {
  apiKeyRequest,
  apiKeySchema,
  auditPageSchema,
  benchmarkSchema,
  createdApiKeySchema,
  createdBulkEnrollmentsSchema,
  createdEnrollmentSchema,
  enrollmentSchema,
  memberSchema,
  modelSchema,
  modelUploadSchema,
  nodeSchema,
  organisationSchema,
  poolSchema,
  metricsSchema,
  usageSchema,
  type AddMemberForm,
  type ApiKeyForm,
  type Limits,
  type ModelFromUrlForm,
  type ModelKind,
  type OrgRole,
  type OrganisationForm,
  type PoolForm,
} from './schemas';
import { saveFile } from '../lib/saveFile';
import type { PutPart } from '../lib/uploadParts';

/**
 * `request` bound to the signed-in user's Dex access token. `ready` is false until the token exists: queries must
 * wait for it (the sidebar mounts before the OIDC redirect has completed, and a tokenless 401 would be cached).
 */
function useRequest() {
  const hasToken = Boolean(useAuth().user?.access_token);
  const getToken = useFreshToken();
  const req = async <T>(
    method: Method,
    path: string,
    schema: Parameters<typeof request<T>>[3],
    body?: unknown,
  ) => {
    try {
      return await request<T>(await getToken(), method, path, schema, body);
    } catch (err) {
      // The token can still be rejected (clock skew, session revoked): renew once and replay.
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      return request<T>(await getToken(true), method, path, schema, body);
    }
  };
  return Object.assign(req, { ready: hasToken });
}

const keys = {
  orgs: ['organisations'] as const,
  org: (id: string) => ['organisations', id] as const,
  pools: (id: string) => ['organisations', id, 'pools'] as const,
  pool: (id: string, poolId: string) => ['organisations', id, 'pools', poolId] as const,
  members: (id: string) => ['organisations', id, 'members'] as const,
  nodes: (id: string, poolId: string) => ['organisations', id, 'pools', poolId, 'nodes'] as const,
  node: (id: string, nodeId: string) => ['organisations', id, 'nodes', nodeId] as const,
  apiKeys: (id: string) => ['organisations', id, 'api-keys'] as const,
  models: (id: string) => ['organisations', id, 'models'] as const,
  poolModels: (id: string, poolId: string) =>
    ['organisations', id, 'pools', poolId, 'models'] as const,
  benchmarks: (id: string, poolId: string) =>
    ['organisations', id, 'pools', poolId, 'benchmarks'] as const,
  metrics: (id: string, params: string) => ['organisations', id, 'metrics', params] as const,
  usage: (id: string, params: string) => ['organisations', id, 'usage', params] as const,
};

export function useOrganisations() {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.orgs,
    queryFn: () => req('GET', '/organisations', z.array(organisationSchema)),
  });
}

export function useOrganisation(orgId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.org(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}`, organisationSchema),
    retry: false,
  });
}

export function useCreateOrganisation() {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrganisationForm) => req('POST', '/organisations', organisationSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.orgs }),
  });
}

export function useUpdateOrganisation(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrganisationForm> & { limits?: Partial<Limits> }) =>
      req('PATCH', `/organisations/${orgId}`, organisationSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.orgs }),
  });
}

/** Deletes the signed-in account (memberships only; Dex is untouched). The caller signs out afterwards. */
export function useDeleteAccount() {
  const req = useRequest();
  return useMutation({ mutationFn: () => req('DELETE', '/me', null) });
}

export function useDeleteOrganisation(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => req('DELETE', `/organisations/${orgId}`, null),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.org(orgId) });
      return qc.invalidateQueries({ queryKey: keys.orgs });
    },
  });
}

/** Live status refreshes on its own: nodes report every few seconds. */
const LIVE_REFRESH_MS = 10_000;

export function usePools(orgId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.pools(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}/pools`, z.array(poolSchema)),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function usePool(orgId: string, poolId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.pool(orgId, poolId),
    queryFn: () => req('GET', `/organisations/${orgId}/pools/${poolId}`, poolSchema),
    retry: false,
  });
}

export function useCreatePool(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PoolForm) => req('POST', `/organisations/${orgId}/pools`, poolSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pools(orgId) }),
  });
}

export function useUpdatePool(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poolId, ...body }: Partial<PoolForm> & { poolId: string }) =>
      req('PATCH', `/organisations/${orgId}/pools/${poolId}`, poolSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pools(orgId) }),
  });
}

export function useDeletePool(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poolId: string) => req('DELETE', `/organisations/${orgId}/pools/${poolId}`, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pools(orgId) }),
  });
}

export function useMembers(orgId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.members(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}/members`, z.array(memberSchema)),
  });
}

export function useAddMember(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMemberForm) =>
      req('POST', `/organisations/${orgId}/members`, memberSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(orgId) }),
  });
}

export function useUpdateMemberRole(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: OrgRole }) =>
      req('PATCH', `/organisations/${orgId}/members/${encodeURIComponent(email)}`, memberSchema, {
        role,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(orgId) }),
  });
}

export function useRemoveMember(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      req('DELETE', `/organisations/${orgId}/members/${encodeURIComponent(email)}`, null),
    onSuccess: () =>
      qc
        .invalidateQueries({ queryKey: keys.orgs })
        .then(() => qc.invalidateQueries({ queryKey: keys.members(orgId) })),
  });
}

export interface UsageParams {
  from: string;
  to: string;
  granularity: 'hour' | 'day';
  groupBy?: 'pool' | 'key' | 'model';
  poolId?: string;
}

export function useUsage(orgId: string, params: UsageParams) {
  const req = useRequest();
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  ).toString();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.usage(orgId, qs),
    queryFn: () => req('GET', `/organisations/${orgId}/usage?${qs}`, usageSchema),
  });
}

export interface MetricsParams {
  /** Window length in ms, ending now; it slides with every refresh. */
  windowMs: number;
  poolId?: string;
  nodeId?: string;
}

/** Operational metrics of an organisation, narrowed to a pool or a node; `live` refreshes it every 15 s. */
export function useMetrics(orgId: string, params: MetricsParams, live: boolean) {
  const req = useRequest();
  const key = [params.windowMs, params.poolId ?? '', params.nodeId ?? ''].join('|');
  return useQuery({
    enabled: req.ready,
    queryKey: keys.metrics(orgId, key),
    refetchInterval: live ? 15_000 : false,
    // Keep the old chart on screen while a new window loads.
    placeholderData: (previous) => previous,
    queryFn: () => {
      const to = new Date();
      const qs = new URLSearchParams({
        from: new Date(to.getTime() - params.windowMs).toISOString(),
        to: to.toISOString(),
        ...(params.poolId ? { poolId: params.poolId } : {}),
        ...(params.nodeId ? { nodeId: params.nodeId } : {}),
      }).toString();
      return req('GET', `/organisations/${orgId}/metrics?${qs}`, metricsSchema);
    },
  });
}

export interface AuditParams {
  /** Exact action, or a prefix ending in a dot (`pool.`). */
  action?: string;
  outcome?: 'success' | 'denied' | 'failed';
}

/** Audit log pages, newest first (admins only; the server answers 403 otherwise). */
export function useAuditLogs(orgId: string, params: AuditParams, enabled = true) {
  const req = useRequest();
  return useInfiniteQuery({
    enabled: req.ready && enabled,
    queryKey: ['organisations', orgId, 'audit', params] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams(
        Object.entries({ ...params, cursor: pageParam, limit: '30' }).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ).toString();
      return req('GET', `/organisations/${orgId}/audit-logs?${qs}`, auditPageSchema);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Downloads the audit log (same filters as the list) as a CSV or JSON file. */
export function useExportAuditLogs(orgId: string) {
  const getToken = useFreshToken();
  return useMutation({
    mutationFn: async ({ params, format }: { params: AuditParams; format: 'csv' | 'json' }) => {
      const qs = new URLSearchParams(
        Object.entries({ ...params, format }).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ).toString();
      const path = `/organisations/${orgId}/audit-logs/export?${qs}`;
      let blob: Blob;
      try {
        blob = await requestBlob(await getToken(), path);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        blob = await requestBlob(await getToken(true), path);
      }
      saveFile(blob, `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
  });
}

// ---- Nodes ----------------------------------------------------------------------------------------------------

export function useNodes(orgId: string, poolId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.nodes(orgId, poolId),
    queryFn: () => req('GET', `/organisations/${orgId}/pools/${poolId}/nodes`, z.array(nodeSchema)),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useNode(orgId: string, nodeId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.node(orgId, nodeId),
    queryFn: () => req('GET', `/organisations/${orgId}/nodes/${nodeId}`, nodeSchema),
    refetchInterval: LIVE_REFRESH_MS,
    retry: false,
  });
}

export function useUpdateNode(orgId: string, nodeId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name?: string;
      approved?: true;
      /** null clears the override (the device decides). */
      computeBackend?: 'cpu' | 'gpu' | null;
      maxContextTokens?: number | null;
      keepScreenOn?: boolean | null;
      enableMtp?: boolean | null;
    }) => req('PATCH', `/organisations/${orgId}/nodes/${nodeId}`, nodeSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organisations', orgId] }),
  });
}

/** Asks a connected device to restart its app (it finishes what it is serving first). */
export function useRestartNode(orgId: string, nodeId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: () =>
      req('POST', `/organisations/${orgId}/nodes/${nodeId}/restart`, z.object({ id: z.string() })),
  });
}

export function useDeleteNode(orgId: string, nodeId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => req('DELETE', `/organisations/${orgId}/nodes/${nodeId}`, null),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.node(orgId, nodeId) });
      return qc.invalidateQueries({ queryKey: ['organisations', orgId, 'pools'] });
    },
  });
}

// ---- Enrollment -----------------------------------------------------------------------------------------------

export function useCreateEnrollment(orgId: string, poolId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: () =>
      req(
        'POST',
        `/organisations/${orgId}/pools/${poolId}/enrollments`,
        createdEnrollmentSchema,
        {},
      ),
  });
}

/** Several codes at once (one per device); every code is returned only here. */
export function useCreateBulkEnrollments(orgId: string, poolId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: (count: number) =>
      req(
        'POST',
        `/organisations/${orgId}/pools/${poolId}/enrollments/bulk`,
        createdBulkEnrollmentsSchema,
        { count },
      ),
  });
}

/** Codes of the pool that are still unused and unexpired (a used code disappears). */
export function useActiveEnrollments(orgId: string, poolId: string, enabled: boolean) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready && enabled,
    queryKey: ['organisations', orgId, 'pools', poolId, 'enrollments'] as const,
    queryFn: () =>
      req('GET', `/organisations/${orgId}/pools/${poolId}/enrollments`, z.array(enrollmentSchema)),
    refetchInterval: 3000,
  });
}

export function useCancelEnrollment(orgId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: (enrollmentId: string) =>
      req('DELETE', `/organisations/${orgId}/enrollments/${enrollmentId}`, null),
  });
}

// ---- Models ---------------------------------------------------------------------------------------------------

const MODEL_REFRESH_MS = 3_000;

export function useModels(orgId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.models(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}/models`, z.array(modelSchema)),
    // Downloads progress on the server; keep polling while any model is still on its way.
    refetchInterval: (q) =>
      q.state.data?.some((m) => m.status === 'pending' || m.status === 'downloading')
        ? MODEL_REFRESH_MS
        : false,
  });
}

export function useAddModelFromUrl(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelFromUrlForm & { kind: ModelKind }) =>
      req('POST', `/organisations/${orgId}/models/from-url`, modelSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.models(orgId) }),
  });
}

export function useStartModelUpload(orgId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: (body: { name: string; kind: ModelKind; fileName: string; sizeBytes: number }) =>
      req('POST', `/organisations/${orgId}/models/uploads`, modelUploadSchema, body),
  });
}

/** Uploads one part of a browser upload; reads the freshest token for every part (uploads outlive token lifetimes). */
export function usePartUploader(orgId: string) {
  const getToken = useFreshToken();
  return (modelId: string): PutPart =>
    async (partNumber, body, onProgress, signal) =>
      putPart(
        await getToken(),
        `/organisations/${orgId}/models/${modelId}/parts/${partNumber}`,
        body,
        onProgress,
        signal,
      );
}

export function useCompleteModelUpload(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      parts,
    }: {
      modelId: string;
      parts: { partNumber: number; etag: string }[];
    }) => req('POST', `/organisations/${orgId}/models/${modelId}/complete`, modelSchema, { parts }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.models(orgId) }),
  });
}

export function useRetryModel(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      req('POST', `/organisations/${orgId}/models/${modelId}/retry`, modelSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.models(orgId) }),
  });
}

export function useDeleteModel(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      req('DELETE', `/organisations/${orgId}/models/${modelId}`, null),
    // A deleted model also leaves the pools that served it.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organisations', orgId] }),
  });
}

export function usePoolModels(orgId: string, poolId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.poolModels(orgId, poolId),
    queryFn: () =>
      req('GET', `/organisations/${orgId}/pools/${poolId}/models`, z.array(modelSchema)),
  });
}

export function useAssignModel(orgId: string, poolId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      req('PUT', `/organisations/${orgId}/pools/${poolId}/models/${modelId}`, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.poolModels(orgId, poolId) }),
  });
}

export function useUnassignModel(orgId: string, poolId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      req('DELETE', `/organisations/${orgId}/pools/${poolId}/models/${modelId}`, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.poolModels(orgId, poolId) }),
  });
}

export function useApiKeys(orgId: string, enabled = true) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready && enabled,
    queryKey: keys.apiKeys(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}/api-keys`, z.array(apiKeySchema)),
  });
}

/** Resolves with the secret, which the server returns only once. */
export function useCreateApiKey(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ form, limits }: { form: ApiKeyForm; limits?: Limits }) =>
      req(
        'POST',
        `/organisations/${orgId}/api-keys`,
        createdApiKeySchema,
        apiKeyRequest(form, Date.now(), limits),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys(orgId) }),
  });
}

export function useUpdateApiKeyLimits(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, limits }: { keyId: string; limits: Limits }) =>
      req('PATCH', `/organisations/${orgId}/api-keys/${keyId}`, apiKeySchema, { limits }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys(orgId) }),
  });
}

export function useUpdateApiKeyExpiry(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, expiresAt }: { keyId: string; expiresAt: string | null }) =>
      req('PATCH', `/organisations/${orgId}/api-keys/${keyId}`, apiKeySchema, { expiresAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys(orgId) }),
  });
}

export function useRevokeApiKey(orgId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => req('DELETE', `/organisations/${orgId}/api-keys/${keyId}`, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.apiKeys(orgId) }),
  });
}

const BENCHMARK_REFRESH_MS = 3_000;

/** The pool's latest benchmarks; polls while one is running (the gateways fill in the results). */
export function useBenchmarks(orgId: string, poolId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.benchmarks(orgId, poolId),
    queryFn: () =>
      req('GET', `/organisations/${orgId}/pools/${poolId}/benchmarks`, z.array(benchmarkSchema)),
    refetchInterval: (q) =>
      q.state.data?.some((b) => b.status === 'running') ? BENCHMARK_REFRESH_MS : false,
  });
}

export function useRunBenchmark(orgId: string, poolId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      req('POST', `/organisations/${orgId}/pools/${poolId}/benchmarks`, benchmarkSchema, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.benchmarks(orgId, poolId) }),
  });
}

export function useDeleteBenchmark(orgId: string, poolId: string) {
  const req = useRequest();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (benchmarkId: string) =>
      req('DELETE', `/organisations/${orgId}/pools/${poolId}/benchmarks/${benchmarkId}`, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.benchmarks(orgId, poolId) }),
  });
}
