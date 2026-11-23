import type { Consent } from './consent';

// Google Analytics 4 (gtag.js), the one third party this app talks to from the browser, and only in production, only
// after the visitor accepted. Nothing is loaded or sent before that. Only page views are sent: the path (ids replaced,
// no query, no hash) and the generic page title. Never anything a user typed, prompts, answers, keys or codes.
// A copy of this file lives in src/web-node/src/analytics (the projects share no code): keep them in step.

interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  [disable: `ga-disable-${string}`]: boolean;
}

const ID_PATTERN = /^G-[A-Z0-9]{4,}$/;
export const isMeasurementId = (value: unknown): value is string =>
  typeof value === 'string' && ID_PATTERN.test(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path as reported: organisation, pool and device ids (and any other id-like segment) become `:id`. */
export function sanitizePath(pathname: string): string {
  const segments = pathname.split('/');
  return segments
    .map((segment, i) => {
      const before = segments[i - 1];
      const isId =
        UUID.test(segment) ||
        (['organisations', 'pools', 'nodes'].includes(before ?? '') && segment !== '') ||
        /^[0-9a-f]{16,}$/i.test(segment);
      return isId ? ':id' : segment;
    })
    .join('/');
}

let started = '';
let scriptAdded = false;

function gtagOf(w: GtagWindow) {
  if (!w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    const layer = w.dataLayer;
    // gtag.js reads `arguments` objects from the data layer, not arrays
    w.gtag = function gtag() {
      layer.push(arguments);
    };
  }
  return w.gtag;
}

function deleteAnalyticsCookies(id: string) {
  const names = ['_ga', `_ga_${id.slice(2)}`];
  const host = window.location.hostname;
  const parts = host.split('.');
  const domains = [host, ...parts.slice(1).map((_, i) => '.' + parts.slice(i + 1).join('.'))];
  for (const name of names) {
    for (const domain of ['', ...domains]) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`;
    }
  }
}

/**
 * Puts the visitor's choice into effect. Granted: consent update and gtag.js is loaded (once). Denied: consent
 * revoked, collection switched off and the Analytics cookies removed. Undecided: nothing happens.
 */
export function applyConsent(id: string, consent: Consent): void {
  if (consent === null) return;
  const w = window as unknown as GtagWindow;
  const gtag = gtagOf(w);
  if (started !== id) {
    started = id;
    gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    gtag('js', new Date());
    gtag('config', id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: 'SameSite=Lax;Secure',
    });
  }
  if (consent === 'granted') {
    w[`ga-disable-${id}`] = false;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (!scriptAdded) {
      scriptAdded = true;
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.appendChild(script);
    }
  } else {
    w[`ga-disable-${id}`] = true;
    gtag('consent', 'update', { analytics_storage: 'denied' });
    deleteAnalyticsCookies(id);
  }
}

/** One page view (only while consent is granted; call `applyConsent` first). */
export function trackPageView(pathname: string): void {
  const w = window as unknown as GtagWindow;
  if (!w.gtag) return;
  const path = sanitizePath(pathname);
  w.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: document.title,
  });
}

/** Test only: forget what was started. */
export function resetAnalyticsForTests(): void {
  started = '';
  scriptAdded = false;
}
