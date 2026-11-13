import { WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

/**
 * Dex lives next to the web app: `app.<domain>` -> `dex.<domain>` (same scheme-less domain, https).
 *   app.splitcortex.127.0.0.1.nip.io -> https://dex.splitcortex.127.0.0.1.nip.io
 *   app.stg.splitcortex.com          -> https://dex.stg.splitcortex.com
 * `VITE_OIDC_AUTHORITY` overrides it (e.g. when the UI runs on plain `localhost`).
 */
export function getDexAuthority(location: Pick<Location, 'hostname'> = window.location): string {
  const override = import.meta.env.VITE_OIDC_AUTHORITY as string | undefined;
  if (override) return override;
  return `https://${location.hostname.replace(/^app\./, 'dex.')}`;
}

/** Public client registered in Dex (`staticClients`, `public: true`): code flow + PKCE, no secret. */
export const OIDC_CLIENT_ID = 'splitcortex-ui';

export function buildOidcConfig(): UserManagerSettings {
  return {
    authority: getDexAuthority(),
    client_id: OIDC_CLIENT_ID,
    redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid profile email offline_access',
    automaticSilentRenew: true,
    // Dex has no end_session_endpoint, so sign-out is local (see useSignOut).
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  };
}
