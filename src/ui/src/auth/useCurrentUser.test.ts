import { renderHook } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrentUser } from './useCurrentUser';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

function signedIn(profile: Record<string, string>) {
  vi.mocked(useAuth).mockReturnValue({ user: { profile } } as unknown as ReturnType<
    typeof useAuth
  >);
}

describe('useCurrentUser', () => {
  beforeEach(() => vi.mocked(useAuth).mockReset());

  it('is null when signed out', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
    expect(renderHook(() => useCurrentUser()).result.current).toBeNull();
  });

  it('uses the name when present', () => {
    signedIn({ sub: 's1', name: 'Ada', email: 'ada@example.test' });
    expect(renderHook(() => useCurrentUser()).result.current).toEqual({
      name: 'Ada',
      email: 'ada@example.test',
    });
  });

  it('falls back to email, then sub', () => {
    signedIn({ sub: 's1', email: 'ada@example.test' });
    expect(renderHook(() => useCurrentUser()).result.current?.name).toBe('ada@example.test');
    signedIn({ sub: 's1' });
    expect(renderHook(() => useCurrentUser()).result.current?.name).toBe('s1');
  });
});
