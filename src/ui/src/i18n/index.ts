import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';
import { setSharedCookie } from '../lib/sharedCookie';
import { languageOfPath } from '../seo/pages';
import { SUPPORTED_LANGUAGES } from './languages';

export { SUPPORTED_LANGUAGES, type Language } from './languages';

// A language prefix in the URL (`/ro/about`) decides the language: that is the page a search result or a shared link
// points at. Bare URLs fall through to the saved choice, then the browser.
const detector = new LanguageDetector();
detector.addDetector({
  name: 'path',
  lookup: () => languageOfPath(window.location.pathname) ?? undefined,
});

// The prerender (src/entry-server.tsx) renders with its own instances, so nothing is initialised outside a browser.
const initialised: Promise<unknown> =
  typeof window === 'undefined'
    ? Promise.resolve()
    : i18n
        .use(HttpBackend)
        .use(detector)
        .use(initReactI18next)
        .init({
          fallbackLng: 'en',
          supportedLngs: SUPPORTED_LANGUAGES,
          nonExplicitSupportedLngs: true, // en-US -> en
          load: 'languageOnly',
          defaultNS: 'translation',
          // Translations are static JSON files in public/locales/<lng>/translation.json.
          backend: { loadPath: '/locales/{{lng}}/translation.json' },
          detection: {
            order: ['path', 'localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'sc-lang',
          },
          interpolation: { escapeValue: false }, // React escapes
        });

/** Resolves once the first language is loaded: the app renders after it, so the prerendered page stays until then. */
export const i18nReady = initialised;

// The Dex login theme follows the app's language through this cookie (see lib/sharedCookie.ts). Also written once
// after init: the detected language is not always announced as a change at startup.
if (typeof window !== 'undefined') {
  const syncLanguage = (lng: string) => {
    document.documentElement.lang = lng.slice(0, 2); // en-US -> en
    setSharedCookie('sc-lang', lng.slice(0, 2));
  };
  i18n.on('languageChanged', syncLanguage);
  void initialised.then(() => syncLanguage(i18n.language));
}

export default i18n;
