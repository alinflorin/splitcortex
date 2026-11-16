/**
 * The web node lives next to the web app: `app.<domain>` -> `web-node.<domain>` (https).
 * `VITE_WEB_NODE_URL` overrides it (e.g. when the UI runs on plain `localhost`).
 */
export function getWebNodeUrl(location: Pick<Location, 'hostname'> = window.location): string {
  const override = import.meta.env.VITE_WEB_NODE_URL as string | undefined;
  const origin = override || `https://${location.hostname.replace(/^app\./, 'web-node.')}`;
  return origin.replace(/\/+$/, '');
}
