import { expect, test } from '@playwright/test';
import { baseUrl, dexUrl, webNodeUrl } from '../lib/env';

// What search engines and link previews see, without running any script: the prerendered public pages (English at the
// bare URL, Romanian under /ro), robots.txt, the sitemap, noindex for the signed-in app and for every host that is not
// the public site. Local and stg are closed to crawlers (SEO_INDEXABLE=false); only production is open, and the open
// case is checked too when this runs against it.

const html = async (request: import('@playwright/test').APIRequestContext, path: string) => {
  const res = await request.get(`${baseUrl()}${path}`);
  return { res, body: await res.text() };
};

test('public pages are real HTML, in English and in Romanian, with their own head', async ({
  request,
}) => {
  const host = new URL(baseUrl()).host;
  const pages: [path: string, lang: string, h1: RegExp, canonical: string][] = [
    ['/', 'en', /Your devices\./, `https://${host}/`],
    ['/quick-start', 'en', /From zero to your first answer/, `https://${host}/quick-start`],
    ['/help', 'en', /Help and documentation/, `https://${host}/help`],
    ['/about', 'en', /About SplitCortex/, `https://${host}/about`],
    ['/terms', 'en', /Terms of Service/, `https://${host}/terms`],
    ['/privacy', 'en', /Privacy Policy/, `https://${host}/privacy`],
    ['/contact', 'en', /Get in touch/, `https://${host}/contact`],
    ['/ro', 'ro', /Dispozitivele tale\./, `https://${host}/ro`],
    ['/ro/quick-start', 'ro', /De la zero la primul răspuns/, `https://${host}/ro/quick-start`],
    ['/ro/help', 'ro', /Ajutor și documentație/, `https://${host}/ro/help`],
    ['/ro/about', 'ro', /Despre SplitCortex/, `https://${host}/ro/about`],
    ['/ro/terms', 'ro', /Termeni/, `https://${host}/ro/terms`],
    ['/ro/privacy', 'ro', /Politica de confiden/, `https://${host}/ro/privacy`],
    ['/ro/contact', 'ro', /Contactează-ne/, `https://${host}/ro/contact`],
  ];
  for (const [path, lang, h1, canonical] of pages) {
    const { res, body } = await html(request, path);
    expect(res.status(), path).toBe(200);
    expect(body, path).toContain(`<html lang="${lang}"`);
    expect(body, path).toMatch(h1);
    expect(body, `${path} canonical`).toContain(
      `<link data-seo rel="canonical" href="${canonical}" />`,
    );
    expect(body, `${path} hreflang`).toMatch(/hreflang="ro" href="https:\/\/[^"]+\/ro(\/[a-z]+)?"/);
    expect(body, `${path} hreflang`).toContain('hreflang="x-default"');
    expect(body, `${path} description`).toMatch(
      /<meta data-seo name="description" content="[^"]{50,}"/,
    );
    expect(body, `${path} og:image`).toContain(`content="https://${host}/og-image.png"`);
    expect(body, `${path} no placeholder left`).not.toContain('{{');
    expect(body, `${path} script`).toContain('<script type="module"');
  }
});

test('robots.txt and the sitemap follow the environment', async ({ request }) => {
  const robots = await (await request.get(`${baseUrl()}/robots.txt`)).text();
  const sitemap = await request.get(`${baseUrl()}/sitemap.xml`);
  const header = (await request.get(baseUrl())).headers()['x-robots-tag'];
  if (/^Disallow: \/$/m.test(robots)) {
    // local, stg: closed to crawlers, twice (robots.txt and a header on every response)
    expect(header).toContain('noindex');
    expect(sitemap.status()).toBe(404);
  } else {
    // production: open, with the sitemap announced under its own host
    expect(robots).toContain(`Sitemap: ${baseUrl()}/sitemap.xml`);
    expect(header).toBeUndefined();
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    for (const path of ['/', '/quick-start', '/help', '/about', '/terms', '/privacy', '/contact', '/ro', '/ro/quick-start', '/ro/help', '/ro/about']) {
      expect(xml).toContain(`<loc>${baseUrl()}${path}</loc>`);
    }
    expect(xml).toContain('hreflang="ro"');
  }
});

test('the signed-in app and unknown URLs are noindex; unknown URLs are a real 404', async ({
  request,
}) => {
  for (const path of [
    '/organisations',
    '/organisations/abc/pools',
    '/playground',
    '/user-settings',
  ]) {
    const { res, body } = await html(request, path);
    expect(res.status(), path).toBe(200);
    expect(body, path).toContain('<meta data-seo name="robots" content="noindex, nofollow" />');
    expect(body, path).not.toContain('rel="canonical"');
    expect(res.headers()['x-robots-tag'], path).toContain('noindex');
  }
  for (const path of ['/nope', '/ro/nope', '/about/nope']) {
    const { res, body } = await html(request, path);
    expect(res.status(), path).toBe(404);
    expect(body, path).toContain('noindex');
  }
  // an asset that does not exist is a 404, not the index page
  expect((await request.get(`${baseUrl()}/assets/nope.js`)).status()).toBe(404);
});

test('no redirect hops: a page with and without a trailing slash is served in place', async ({
  request,
}) => {
  for (const path of ['/about', '/about/', '/ro', '/ro/', '/ro/contact']) {
    const res = await request.get(`${baseUrl()}${path}`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }
});

test('the other hosts are never indexed', async ({ request }) => {
  for (const url of [
    `${dexUrl()}/.well-known/openid-configuration`,
    `${webNodeUrl()}/`,
    `${baseUrl()}/api/health`,
  ]) {
    const res = await request.get(url);
    expect(res.headers()['x-robots-tag'], url).toContain('noindex');
  }
  expect(await (await request.get(`${webNodeUrl()}/robots.txt`)).text()).toContain('Disallow: /');
});

test('the app takes over the prerendered page and keeps the URL and language in step', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${baseUrl()}/ro/about`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Despre SplitCortex');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ro');
  expect(await page.title()).toContain('Despre SplitCortex');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', /\/ro\/about$/);
  // footer: the same page in the other language is a plain link
  await page
    .getByRole('navigation', { name: 'Limbă' })
    .getByRole('link', { name: 'English' })
    .click();
  await page.waitForURL(`${baseUrl()}/about`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('About SplitCortex');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(errors).toEqual([]);
});
