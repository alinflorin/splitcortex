/**
 * The control plane is served at `/api` on this same host (the chart routes `web-node.<domain>/api` to it), so there is
 * no CORS and nothing to configure. `VITE_ENROLLMENT_URL` overrides it for a standalone `pnpm dev`.
 */
export function enrollmentUrl(origin: string = window.location.origin): string {
  const override = import.meta.env.VITE_ENROLLMENT_URL as string | undefined;
  return (override || `${origin}/api`).replace(/\/+$/, '');
}

/** The app version reported to the gateway. */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || 'web';
