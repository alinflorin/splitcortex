import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { z } from 'zod';
import { putPart, request } from './client';
import type { Method } from './client';
import {
  memberSchema,
  modelSchema,
  modelUploadSchema,
  nodeSchema,
  organisationSchema,
  poolSchema,
  usageSchema,
  type AddMemberForm,
  type ModelFromUrlForm,
  type OrgRole,
  type OrganisationForm,
  type PoolForm,
} from './schemas';
import type { PutPart } from '../lib/uploadParts';

/**
 * `request` bound to the signed-in user's Dex access token. `ready` is false until the token exists: queries must
 * wait for it (the sidebar mounts before the OIDC redirect has completed, and a tokenless 401 would be cached).
 */
function useRequest() {
  const token = useAuth().user?.access_token;
  const req = <T>(
    method: Method,
    path: string,
    schema: Parameters<typeof request<T>>[3],
    body?: unknown,
  ) => request<T>(token, method, path, schema, body);
  return Object.assign(req, { ready: Boolean(token) });
}

const keys = {
  orgs: ['organisations'] as const,
  org: (id: string) => ['organisations', id] as const,
  pools: (id: string) => ['organisations', id, 'pools'] as const,
  pool: (id: string, poolId: string) => ['organisations', id, 'pools', poolId] as const,
  members: (id: string) => ['organisations', id, 'members'] as const,
  nodes: (id: string, poolId: string) => ['organisations', id, 'pools', poolId, 'nodes'] as const,
  node: (id: string, nodeId: string) => ['organisations', id, 'nodes', nodeId] as const,
  models: (id: string) => ['organisations', id, 'models'] as const,
  poolModels: (id: string, poolId: string) =>
    ['organisations', id, 'pools', poolId, 'models'] as const,
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
    mutationFn: (body: Partial<OrganisationForm>) =>
      req('PATCH', `/organisations/${orgId}`, organisationSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.orgs }),
  });
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

export function usePools(orgId: string) {
  const req = useRequest();
  return useQuery({
    enabled: req.ready,
    queryKey: keys.pools(orgId),
    queryFn: () => req('GET', `/organisations/${orgId}/pools`, z.array(poolSchema)),
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

// ---- Nodes ----------------------------------------------------------------------------------------------------

/** Live status refreshes on its own: nodes report every few seconds. */
const LIVE_REFRESH_MS = 10_000;

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
    mutationFn: (body: { name?: string; approved?: true }) =>
      req('PATCH', `/organisations/${orgId}/nodes/${nodeId}`, nodeSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organisations', orgId] }),
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
    mutationFn: (body: ModelFromUrlForm) =>
      req('POST', `/organisations/${orgId}/models/from-url`, modelSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.models(orgId) }),
  });
}

export function useStartModelUpload(orgId: string) {
  const req = useRequest();
  return useMutation({
    mutationFn: (body: { name: string; fileName: string; sizeBytes: number }) =>
      req('POST', `/organisations/${orgId}/models/uploads`, modelUploadSchema, body),
  });
}

/** Uploads one part of a browser upload; reads the freshest token for every part (uploads outlive token lifetimes). */
export function usePartUploader(orgId: string) {
  const token = useAuth().user?.access_token;
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  return (modelId: string): PutPart =>
    (partNumber, body, onProgress, signal) =>
      putPart(
        tokenRef.current,
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
