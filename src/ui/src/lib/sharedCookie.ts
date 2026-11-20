/**
 * Dex (`dex.<domain>`) cannot read this origin's localStorage, so settings its login pages follow (theme, language)
 * are mirrored in a cookie on the shared parent domain (the web app is served on `<domain>`, so the cookie's `Domain` is its own host; dex.<domain> is a subdomain). `null` removes it.
 */
export function setSharedCookie(name: string, value: string | null) {
  const { hostname, protocol } = window.location;
  // Plain `localhost` and IP addresses cannot carry a Domain attribute.
  const shared = hostname.includes('.') && !/^[\d.]+$/.test(hostname);
  const domain = shared ? `; Domain=${hostname}` : '';
  const secure = protocol === 'https:' ? '; Secure' : '';
  const maxAge = value === null ? 0 : 31536000;
  document.cookie = `${name}=${value ?? ''}${domain}; Path=/; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}
