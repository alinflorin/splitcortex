/**
 * Dex (`dex.<domain>`) cannot read this origin's localStorage, so settings its login pages follow (theme, language)
 * are mirrored in a cookie on the shared parent domain (`app.<domain>` -> `<domain>`). `null` removes it.
 */
export function setSharedCookie(name: string, value: string | null) {
  const { hostname, protocol } = window.location;
  const domain = hostname.startsWith('app.') ? `; Domain=${hostname.slice(4)}` : '';
  const secure = protocol === 'https:' ? '; Secure' : '';
  const maxAge = value === null ? 0 : 31536000;
  document.cookie = `${name}=${value ?? ''}${domain}; Path=/; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}
