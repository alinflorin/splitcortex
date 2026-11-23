// Prerender: writes real HTML for every public page, in every language, into `dist`, plus the app shell, the sitemap
// and the Caddy-templated pieces. Run after `vite build` (client, into dist) and `vite build --ssr src/entry-server.tsx
// --outDir dist-ssr` (this script's renderer); the Dockerfile does all three.
//
//   dist/index.html, dist/about/index.html, ...   the public pages in English (bare URLs)
//   dist/ro/index.html, dist/ro/about/index.html  ... and in Romanian
//   dist/app.html                                  the shell of every other URL (signed-in app, 404): content-less, noindex
//   dist/sitemap.xml                               every public URL with its hreflang alternates
//
// The same image runs on every environment (local, stg, prd), so the host is not known here: canonical URLs, hreflang
// links, Open Graph URLs and the sitemap carry `{{.Host}}`, which Caddy's `templates` directive fills in per request
// (see Caddyfile). Any other `{{` in the HTML is escaped so Caddy leaves it alone.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.argv[2] ?? 'dist';
const ssrDir = process.argv[3] ?? 'dist-ssr';
const LANGUAGES = ['en', 'ro'];
const DEFAULT_LANGUAGE = 'en';
const HOST = '__SC_HOST__';
const ORIGIN = `https://${HOST}`;

// Imported before the browser stand-ins below exist, so modules that check `typeof window` see a server.
const { render, renderShell, publicUrls } = await import(
  pathToFileURL(join(ssrDir, 'entry-server.js')).href
);

// What the pages read from `window` while rendering (the endpoints card shows the gateway URL of the host, ...).
const location = {
  hostname: HOST,
  host: HOST,
  origin: ORIGIN,
  protocol: 'https:',
  pathname: '/',
  search: '',
  hash: '',
  href: `${ORIGIN}/`,
};
globalThis.window = {
  location,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const template = readFileSync(join(dist, 'index.html'), 'utf8');

const replaceOnce = (text, pattern, value) => {
  if (!(typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text))) {
    throw new Error(`prerender: ${pattern} not found in the built index.html`);
  }
  return text.replace(pattern, () => value);
};

// Hosts and Go-template syntax: see the header comment.
const forCaddy = (text) => text.replaceAll('{{', '{{"{{"}}').replaceAll(HOST, '{{.Host}}');

function compose({ lang, head, styles = '', html = '', prerendered }) {
  let out = template;
  out = replaceOnce(out, /<html lang="[^"]*"/, `<html lang="${lang}"`);
  out = replaceOnce(out, /<title>[^<]*<\/title>/, head);
  out = replaceOnce(out, '</head>', `${styles}\n  </head>`);
  out = replaceOnce(out, '<div id="root"></div>', `<div id="root"${prerendered ? ' data-prerendered' : ''}>${html}</div>`);
  return forCaddy(out);
}

function write(path, content) {
  const file = join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const urls = publicUrls(LANGUAGES);
for (const { lng, path } of urls) {
  const { html, styles, head } = await render(path, lng, ORIGIN);
  if (!html.includes('<h1')) throw new Error(`prerender: ${path} rendered no heading`);
  write(join(path, 'index.html'), compose({ lang: lng, head, styles, html, prerendered: true }));
  console.log(`prerender: ${path} (${lng}, ${html.length} bytes)`);
}

// Not a public page: the signed-in app, unknown URLs (served with 404). No content, noindex.
const shell = await renderShell(ORIGIN);
write('app.html', compose({ lang: DEFAULT_LANGUAGE, head: shell.head }));

const alternates = (page) =>
  [...LANGUAGES, 'x-default']
    .map((hreflang) => {
      const lng = hreflang === 'x-default' ? DEFAULT_LANGUAGE : hreflang;
      const href = ORIGIN + urls.find((u) => u.page.key === page.key && u.lng === lng).path;
      return `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`;
    })
    .join('\n');
write(
  'sitemap.xml',
  forCaddy(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls
  .map(({ page, path }) => `  <url>\n    <loc>${ORIGIN}${path}</loc>\n${alternates(page)}\n  </url>`)
  .join('\n')}
</urlset>
`,
  ),
);
console.log(`prerender: ${urls.length} pages, app shell, sitemap`);
