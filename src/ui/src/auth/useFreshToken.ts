import { useRef } from 'react';
import { useAuth } from 'react-oidc-context';

/** Renew when the access token has less than this left, so a request never leaves with a token about to expire. */
const MIN_REMAINING_S = 30;

/**
 * Returns `getToken(force?)`: the access token for the next API call. `automaticSilentRenew` only fires while the
 * page is awake (a sleeping laptop or a throttled tab misses it), so the token is checked per call and renewed with
 * the refresh token when it is (nearly) expired or when `force` is set (after a 401). Concurrent callers share one
 * renewal, so the refresh token is spent once. A failed renewal returns the current token: the request then fails
 * with its own 401 and the provider's silent-renew-error handling decides whether to send the user to Dex.
 */
export function useFreshToken() {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const renewed = useRef<typeof auth.user>(undefined);
  const inflight = useRef<Promise<string | undefined> | null>(null);

  const current = () => {
    const user = authRef.current.user;
    // A renewal that finished after the last render is newer than the context's user.
    return renewed.current && (renewed.current.expires_at ?? 0) > (user?.expires_at ?? 0)
      ? renewed.current
      : user;
  };

  return async (force = false): Promise<string | undefined> => {
    const user = current();
    if (!user) return undefined;
    const fresh = (user.expires_in ?? Infinity) > MIN_REMAINING_S;
    if (fresh && !force) return user.access_token;
    if (!user.refresh_token) return user.access_token;
    inflight.current ??= authRef.current
      .signinSilent()
      .then((next) => {
        if (next) renewed.current = next;
        return next?.access_token ?? user.access_token;
      })
      .catch(() => user.access_token)
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  };
}
