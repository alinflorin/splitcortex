import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from '../i18n/languages';

/**
 * The pages anyone (and any crawler) can open without signing in. Each one exists once per language: the default
 * language at the bare path, the others under a `/<lng>` prefix. Everything else is the signed-in app (noindex).
 * The sitemap, hreflang links, canonical URLs and the prerender all come from this list.
 */
export const PUBLIC_PAGES = [
  { key: 'home', path: '/' },
  { key: 'about', path: '/about' },
  { key: 'terms', path: '/terms' },
  { key: 'privacy', path: '/privacy' },
  { key: 'contact', path: '/contact' },
] as const;

export type PublicPage = (typeof PUBLIC_PAGES)[number];
export type PublicPageKey = PublicPage['key'];

const prefixOf = (lng: Language) => (lng === DEFAULT_LANGUAGE ? '' : `/${lng}`);

/** `/about` in the given language: `/about` or `/ro/about`. Paths that are not public pages are returned as they are. */
export function localizedPath(path: string, lng: Language): string {
  const match = /^([^?#]*)(.*)$/.exec(path);
  const base = match?.[1] || '/';
  const suffix = match?.[2] ?? '';
  if (!PUBLIC_PAGES.some((p) => p.path === base)) return path;
  const prefix = prefixOf(lng);
  return `${base === '/' ? prefix || '/' : prefix + base}${suffix}`;
}

/** The language a URL asks for through its prefix (`/ro/...`), or null when it has none. */
export function languageOfPath(pathname: string): Language | null {
  for (const lng of SUPPORTED_LANGUAGES) {
    if (lng === DEFAULT_LANGUAGE) continue;
    const prefix = prefixOf(lng);
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return lng;
  }
  return null;
}

/** Which public page (and language) a pathname is, or null for the signed-in app and unknown paths. */
export function parsePublicPath(pathname: string): { page: PublicPage; lng: Language } | null {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const lng = languageOfPath(trimmed) ?? DEFAULT_LANGUAGE;
  const prefix = prefixOf(lng);
  const rest = trimmed.slice(prefix.length) || '/';
  const page = PUBLIC_PAGES.find((p) => p.path === rest);
  return page ? { page, lng } : null;
}
