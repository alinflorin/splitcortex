/**
 * The control plane's `/api` URL to enroll against. A desktop app has no host of its own, so the user enters it (the
 * web app's address plus `/api`); `VITE_ENROLLMENT_URL` pre-fills it for development.
 */
export const DEFAULT_ENROLLMENT_URL =
  (import.meta.env.VITE_ENROLLMENT_URL as string | undefined) ?? '';

/** The app version reported to the gateway (set from the release tag by CI, see tauri.conf.json). */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
