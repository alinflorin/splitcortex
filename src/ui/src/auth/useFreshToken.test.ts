import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFreshToken } from './useFreshToken';

const auth = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  signinSilent: vi.fn(),
}));
vi.mock('react-oidc-context', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.signinSilent.mockReset();
  auth.user = { access_token: 'old', refresh_token: 'r', expires_in: 3600, expires_at: 2000 };
});

describe('useFreshToken', () => {
  it('returns the current token while it has time left', async () => {
    const { result } = renderHook(() => useFreshToken());
    expect(await result.current()).toBe('old');
    expect(auth.signinSilent).not.toHaveBeenCalled();
  });

  it('renews a nearly expired token once for concurrent callers', async () => {
    auth.user = { ...auth.user, expires_in: 5 };
    auth.signinSilent.mockResolvedValue({
      access_token: 'new',
      expires_in: 3600,
      expires_at: 9000,
    });
    const { result } = renderHook(() => useFreshToken());
    const tokens = await Promise.all([result.current(), result.current()]);
    expect(tokens).toEqual(['new', 'new']);
    expect(auth.signinSilent).toHaveBeenCalledTimes(1);
    expect(await result.current()).toBe('new');
    expect(auth.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('renews on demand after a 401', async () => {
    auth.signinSilent.mockResolvedValue({
      access_token: 'new',
      expires_in: 3600,
      expires_at: 9000,
    });
    const { result } = renderHook(() => useFreshToken());
    expect(await result.current(true)).toBe('new');
  });

  it('falls back to the current token when the renewal fails', async () => {
    auth.user = { ...auth.user, expires_in: -10 };
    auth.signinSilent.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFreshToken());
    expect(await result.current()).toBe('old');
  });

  it('has no token when signed out', async () => {
    auth.user = null;
    const { result } = renderHook(() => useFreshToken());
    expect(await result.current()).toBeUndefined();
  });
});
