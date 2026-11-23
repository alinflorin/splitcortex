import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConsent, resetAnalyticsForTests, sanitizePath, trackPageView } from './gtag';

const ID = 'G-TEST123456';
const scripts = () => document.querySelectorAll('script[src*="googletagmanager"]');
const layer = () =>
  (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((a) => Array.from(a));

beforeEach(() => {
  resetAnalyticsForTests();
  delete (window as unknown as { gtag?: unknown }).gtag;
  delete (window as unknown as { dataLayer?: unknown }).dataLayer;
});
afterEach(() => {
  scripts().forEach((s) => s.remove());
  document.title = '';
});

describe('sanitizePath', () => {
  it('hides organisation, pool and device ids and any uuid', () => {
    expect(sanitizePath('/organisations/acme/pools/main')).toBe('/organisations/:id/pools/:id');
    expect(sanitizePath('/organisations/acme/nodes/7f1c2a3b-0d4e-4f5a-8b6c-9d0e1f2a3b4c')).toBe(
      '/organisations/:id/nodes/:id',
    );
    expect(sanitizePath('/organisations/acme/api-keys')).toBe('/organisations/:id/api-keys');
    expect(sanitizePath('/ro/about')).toBe('/ro/about');
    expect(sanitizePath('/')).toBe('/');
  });
});

describe('applyConsent', () => {
  it('loads nothing while the visitor has not decided, or declined', () => {
    applyConsent(ID, null);
    expect(scripts()).toHaveLength(0);
    applyConsent(ID, 'denied');
    expect(scripts()).toHaveLength(0);
    expect(layer().some((a) => a[0] === 'consent' && a[1] === 'default')).toBe(true);
  });

  it('loads gtag.js once, only after consent, with advertising storage denied', () => {
    applyConsent(ID, 'granted');
    applyConsent(ID, 'granted');
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).toHaveAttribute('src', expect.stringContaining(`id=${ID}`));
    const defaults = layer().find((a) => a[0] === 'consent' && a[1] === 'default')?.[2];
    expect(defaults).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });
    expect(layer()).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    const config = layer().find((a) => a[0] === 'config')?.[2];
    expect(config).toMatchObject({ send_page_view: false, allow_google_signals: false });
  });

  it('withdrawing switches collection off and removes the cookies', () => {
    applyConsent(ID, 'granted');
    document.cookie = '_ga=1; Path=/';
    applyConsent(ID, 'denied');
    expect(layer()).toContainEqual(['consent', 'update', { analytics_storage: 'denied' }]);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(true);
    expect(document.cookie).not.toContain('_ga=');
  });
});

describe('trackPageView', () => {
  it('sends the cleaned path and the generic title, never the query or hash', () => {
    applyConsent(ID, 'granted');
    document.title = 'SplitCortex';
    window.history.replaceState(null, '', '/organisations/acme/pools?code=secret#frag');
    trackPageView('/organisations/acme/pools');
    const event = layer()
      .filter((a) => a[0] === 'event')
      .at(-1);
    expect(event?.[1]).toBe('page_view');
    expect(event?.[2]).toEqual({
      page_path: '/organisations/:id/pools',
      page_location: `${window.location.origin}/organisations/:id/pools`,
      page_title: 'SplitCortex',
    });
    expect(JSON.stringify(event)).not.toContain('secret');
  });
});
