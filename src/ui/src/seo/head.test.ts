import { describe, expect, it } from 'vitest';
import en from '../../public/locales/en/translation.json';
import ro from '../../public/locales/ro/translation.json';
import { PUBLIC_PAGES } from './pages';
import { applyHead, buildHead, renderHeadTags, type HeadTag } from './head';

const origin = 'https://splitcortex.com';
const lookup = (dict: unknown) => (key: string) =>
  key
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict) as string;
const tEn = lookup(en);
const tRo = lookup(ro);

const meta = (tags: HeadTag[], attr: 'name' | 'property', value: string) =>
  tags.find((t) => t.tag === 'meta' && t.attrs[attr] === value);
const links = (tags: HeadTag[], rel: string) =>
  tags.filter(
    (t): t is Extract<HeadTag, { tag: 'link' }> => t.tag === 'link' && t.attrs.rel === rel,
  );

describe('buildHead', () => {
  it('makes a public page indexable, canonical to itself, with every language as an alternate', () => {
    const head = buildHead({ pathname: '/about', origin, t: tEn });
    expect(head.title).toBe(en.seo.about.title);
    expect(meta(head.tags, 'name', 'robots')).toMatchObject({
      attrs: { content: expect.stringContaining('index, follow') },
    });
    expect(links(head.tags, 'canonical').map((l) => l.attrs.href)).toEqual([origin + '/about']);
    expect(links(head.tags, 'alternate').map((l) => [l.attrs.hreflang, l.attrs.href])).toEqual([
      ['en', origin + '/about'],
      ['ro', origin + '/ro/about'],
      ['x-default', origin + '/about'],
    ]);
    expect(meta(head.tags, 'property', 'og:locale')?.tag === 'meta' && 'en_US').toBe('en_US');
    expect(meta(head.tags, 'property', 'og:image')).toMatchObject({
      attrs: { content: origin + '/og-image.png' },
    });
  });

  it('serves the Romanian page under /ro, canonical to itself', () => {
    const head = buildHead({ pathname: '/ro', origin, t: tRo });
    expect(head.title).toBe(ro.seo.home.title);
    expect(links(head.tags, 'canonical')[0]?.attrs.href).toBe(origin + '/ro');
    expect(meta(head.tags, 'property', 'og:locale')).toMatchObject({ attrs: { content: 'ro_RO' } });
  });

  it('has a title and description in both languages for every public page, within search-result lengths', () => {
    for (const { key } of PUBLIC_PAGES) {
      for (const t of [tEn, tRo]) {
        const title = t(`seo.${key}.title`);
        const description = t(`seo.${key}.description`);
        expect(title.length, `${key} title`).toBeGreaterThan(10);
        expect(title.length, `${key} title`).toBeLessThanOrEqual(65);
        expect(description.length, `${key} description`).toBeGreaterThan(50);
        expect(description.length, `${key} description`).toBeLessThanOrEqual(170);
      }
    }
  });

  it('keeps the signed-in app and unknown URLs out of the index', () => {
    for (const pathname of ['/organisations/abc/pools', '/playground', '/ro/nope', '/nope']) {
      const head = buildHead({ pathname, origin, t: tEn });
      expect(head.tags).toEqual([
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } },
      ]);
    }
  });

  it('describes the organisation on the home page as JSON-LD that cannot close the script', () => {
    const head = buildHead({ pathname: '/', origin, t: tEn });
    const script = head.tags.find((t) => t.tag === 'script');
    expect(script?.tag === 'script' && JSON.parse(script.text)['@graph'][0]).toMatchObject({
      '@type': 'Organization',
      url: origin + '/',
    });
    expect(renderHeadTags(head)).not.toContain('</script></script>');
  });
});

describe('applyHead', () => {
  it('replaces the previous page head in the document', () => {
    applyHead(buildHead({ pathname: '/about', origin, t: tEn }));
    applyHead(buildHead({ pathname: '/ro/terms', origin, t: tRo }));
    expect(document.title).toBe(ro.seo.terms.title);
    expect(document.head.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel=canonical]')).toHaveAttribute(
      'href',
      origin + '/ro/terms',
    );
    applyHead(buildHead({ pathname: '/organisations', origin, t: tEn }));
    expect(document.head.querySelector('link[rel=canonical]')).toBeNull();
    expect(document.head.querySelector('meta[name=robots]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });
});
