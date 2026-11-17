/**
 * The gateway lives next to the web app: `app.<domain>` -> `gateway.<domain>` (https).
 * `VITE_GATEWAY_URL` overrides it (e.g. when the UI runs on plain `localhost`).
 */
export function getGatewayBaseUrl(location: Pick<Location, 'hostname'> = window.location): string {
  const override = import.meta.env.VITE_GATEWAY_URL as string | undefined;
  const origin = override || `https://${location.hostname.replace(/^app\./, 'gateway.')}`;
  return `${origin.replace(/\/+$/, '')}/v1`;
}

/** Ready-to-run examples for an OpenAI-format client. The model is a placeholder: it is the pool's model name. */
export function buildKeyExamples(baseUrl: string, secret: string) {
  return {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "<model>", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${secret}")
reply = client.chat.completions.create(
    model="<model>",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`,
  };
}

/** The control plane API: same origin as the web app (`/api`), or `VITE_API_URL` for a standalone dev server. */
export function getApiBaseUrl(location: Pick<Location, 'origin'> = window.location): string {
  const override = import.meta.env.VITE_API_URL as string | undefined;
  return `${(override || location.origin).replace(/\/+$/, '')}/api`;
}

/**
 * Where the Playground calls the gateway from the browser: `/v1` on the web app's own origin (the chart routes it to the
 * gateway, so no CORS). `VITE_GATEWAY_URL` overrides it for a standalone dev server.
 */
export function getPlaygroundBaseUrl(location: Pick<Location, 'origin'> = window.location): string {
  const override = import.meta.env.VITE_GATEWAY_URL as string | undefined;
  return `${(override || location.origin).replace(/\/+$/, '')}/v1`;
}
