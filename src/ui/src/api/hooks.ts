import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import { z } from 'zod';
import { request } from './client';
import type { Method } from './client';
import {
  memberSchema,
  organisationSchema,
  poolSchema,
  usageSchema,
  type AddMemberForm,
  type OrgRole,
  type OrganisationForm,
  type PoolForm,
} from './schemas';

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
