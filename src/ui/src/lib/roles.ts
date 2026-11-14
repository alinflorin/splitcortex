import type { OrgRole } from '../api/schemas';

export const roleRank: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export const isAdmin = (role: OrgRole) => roleRank[role] >= roleRank.admin;

/** Mirrors the control plane: owners manage everyone, admins only plain members. */
export function canManage(actor: OrgRole, ...roles: OrgRole[]): boolean {
  return actor === 'owner' || roles.every((r) => roleRank[r] < roleRank[actor]);
}

/** Roles `actor` may hand out. */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  return (['member', 'admin', 'owner'] as const).filter((r) => canManage(actor, r));
}
