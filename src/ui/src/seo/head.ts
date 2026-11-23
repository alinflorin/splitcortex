import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from '../i18n/languages';
import { localizedPath, parsePublicPath } from './pages';

export type HeadTag =
  | { tag: 'meta'; attrs: Record<string, string> }
  | { tag: 'link'; attrs: Record<string, string> }
  | { tag: 'script'; attrs: Record<string, string>; text: string };

export interface Head {
  title: string;
  tags: HeadTag[];
}

const OG_LOCALE: Record<Language, string> = { en: 'en_US', ro: 'ro_RO' };
export const OG_IMAGE = '/og-image.png';
const LOGO = '/logo-512.png';

interface HeadInput {
  pathname: string;
  /** `https://host`, no trailing slash. */
  origin: string;
  t: (key: string) => string;
}

/**
 * Everything a search engine or a link preview reads from `<head>`. Public pages are indexable in every language and
 * point at each other with hreflang; the URL decides the language. Any other path (the signed-in app, unknown URLs)
 * is `noindex`. Used twice: by the prerender (static HTML for crawlers) and by the running app (client-side navigation).
 */
export function buildHead({ pathname, origin, t }: HeadInput): Head {
  const parsed = parsePublicPath(pathname);
  if (!parsed) {
    return {
      title: t('app.name'),
      tags: [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }],
    };
  }
  const { page, lng } = parsed;
  const url = (l: Language) => origin + localizedPath(page.path, l);
  const title = t(`seo.${page.key}.title`);
  const description = t(`seo.${page.key}.description`);
  const image = origin + OG_IMAGE;
  const meta = (attrs: Record<string, string>): HeadTag => ({ tag: 'meta', attrs });
  const link = (attrs: Record<string, string>): HeadTag => ({ tag: 'link', attrs });

  const tags: HeadTag[] = [
    meta({ name: 'description', content: description }),
    meta({ name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1' }),
    link({ rel: 'canonical', href: url(lng) }),
    ...SUPPORTED_LANGUAGES.map((l) => link({ rel: 'alternate', hreflang: l, href: url(l) })),
    link({ rel: 'alternate', hreflang: 'x-default', href: url(DEFAULT_LANGUAGE) }),
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: t('app.name') }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: description }),
    meta({ property: 'og:url', content: url(lng) }),
    meta({ property: 'og:locale', content: OG_LOCALE[lng] }),
    ...SUPPORTED_LANGUAGES.filter((l) => l !== lng).map((l) =>
      meta({ property: 'og:locale:alternate', content: OG_LOCALE[l] }),
    ),
    meta({ property: 'og:image', content: image }),
    meta({ property: 'og:image:width', content: '1200' }),
    meta({ property: 'og:image:height', content: '630' }),
    meta({ property: 'og:image:alt', content: t('seo.imageAlt') }),
    meta({ name: 'twitter:card', content: 'summary_large_image' }),
    meta({ name: 'twitter:title', content: title }),
    meta({ name: 'twitter:description', content: description }),
    meta({ name: 'twitter:image', content: image }),
  ];

  const graph: Record<string, unknown>[] = [];
  if (page.key === 'home') {
    graph.push(
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: t('app.name'),
        url: `${origin}/`,
        logo: origin + LOGO,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: t('app.name'),
        url: url(lng),
        inLanguage: lng,
        publisher: { '@id': `${origin}/#organization` },
      },
    );
  } else {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: t('nav.home'),
          item: origin + localizedPath('/', lng),
        },
        { '@type': 'ListItem', position: 2, name: title, item: url(lng) },
      ],
    });
  }
  tags.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    // "</" would end the script element early; "<\/" is the same JSON string.
    text: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
      /<\//g,
      '<\\/',
    ),
  });

  return { title, tags };
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The `<head>` markup of a page, for the prerender. Tags carry `data-seo` so the running app can replace them. */
export function renderHeadTags(head: Head): string {
  const attrs = (a: Record<string, string>) =>
    Object.entries(a)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('');
  return head.tags
    .map((tag) =>
      tag.tag === 'script'
        ? `<script data-seo${attrs(tag.attrs)}>${tag.text}</script>`
        : `<${tag.tag} data-seo${attrs(tag.attrs)} />`,
    )
    .join('\n    ');
}

export const renderTitle = (head: Head) => `<title>${escapeText(head.title)}</title>`;

/** Puts a page's head into the live document (client-side navigation, language switch). */
export function applyHead(head: Head, doc: Document = document): void {
  doc.title = head.title;
  doc.head.querySelectorAll('[data-seo]').forEach((el) => el.remove());
  for (const tag of head.tags) {
    const el = doc.createElement(tag.tag);
    el.setAttribute('data-seo', '');
    for (const [k, v] of Object.entries(tag.attrs)) el.setAttribute(k, v);
    if (tag.tag === 'script') el.textContent = tag.text;
    doc.head.appendChild(el);
  }
}
