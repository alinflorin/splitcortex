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

/** A failed silent renewal leaves an expired token that the API rejects; send the user back to sign in instead. */
function SignInOnRenewFailure() {
  const auth = useAuth();
  const { events, signinRedirect, removeUser } = auth;
  useEffect(
    () =>
      events.addSilentRenewError(() => {
        void removeUser().then(() =>
          signinRedirect({
            state: { returnTo: window.location.pathname + window.location.search },
          }),
        );
      }),
    [events, signinRedirect, removeUser],
  );
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
