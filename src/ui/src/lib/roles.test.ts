import { describe, expect, it } from 'vitest';
import { assignableRoles, canManage } from './roles';

describe('roles', () => {
  it('lets owners manage everyone and admins only members', () => {
    expect(canManage('owner', 'owner', 'admin')).toBe(true);
    expect(canManage('admin', 'member', 'member')).toBe(true);
    expect(canManage('admin', 'admin')).toBe(false);
    expect(canManage('member', 'member')).toBe(false);
  });

  it('lists assignable roles', () => {
    expect(assignableRoles('owner')).toEqual(['member', 'admin', 'owner']);
    expect(assignableRoles('admin')).toEqual(['member']);
    expect(assignableRoles('member')).toEqual([]);
  });
});
