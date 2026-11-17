import { useEffect, useMemo, type ReactNode } from 'react';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { buildOidcConfig } from '../lib/oidc';

function returnToOf(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'returnTo' in state) {
    const value = (state as { returnTo: unknown }).returnTo;
    if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  }
  return '/';
}

const RETRY_MS = 30_000;
const DEFINITIVE_ERRORS = new Set([
  'invalid_grant',
  'login_required',
  'invalid_client',
  'unauthorized_client',
]);

/** True when the identity provider itself rejected the refresh (session gone); false for network/server hiccups. */
export function isDefinitiveRenewError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { error?: unknown }).error;
  return typeof code === 'string' && DEFINITIVE_ERRORS.has(code);
}

/**
 * A rejected refresh token means the session is over: sign in again. A transient failure (network, sleep/wake, Dex
 * restarting) keeps the session and retries the renewal until it works.
 */
function SignInOnRenewFailure() {
  const auth = useAuth();
  const { events, signinRedirect, signinSilent, removeUser } = auth;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reSignIn = () =>
      void removeUser().then(() =>
        signinRedirect({
          state: { returnTo: window.location.pathname + window.location.search },
        }),
      );
    const handle = (error: unknown) => {
      clearTimeout(timer);
      if (isDefinitiveRenewError(error)) {
        reSignIn();
        return;
      }
      timer = setTimeout(() => void signinSilent().catch(handle), RETRY_MS);
    };
    const remove = events.addSilentRenewError(handle);
    return () => {
      remove();
      clearTimeout(timer);
    };
  }, [events, signinRedirect, signinSilent, removeUser]);
  return null;
}

/** Must be rendered inside <BrowserRouter> so the callback can navigate back to where the user came from. */
export function OidcProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const config = useMemo(buildOidcConfig, []);

  return (
    <AuthProvider
      {...config}
      onSigninCallback={(user) => {
        // Drops ?code&state from the URL and returns to the originally requested page.
        void navigate(returnToOf(user?.state), { replace: true });
      }}
    >
      <SignInOnRenewFailure />
      {children}
    </AuthProvider>
  );
}
