import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';
import { setSharedCookie } from '../lib/sharedCookie';

export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const initialised = i18n
  .use(HttpBackend)
  .use(LanguageDetector)
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
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'sc-lang',
    },
    interpolation: { escapeValue: false }, // React escapes
  });

// The Dex login theme follows the app's language through this cookie (see lib/sharedCookie.ts). Also written once
// after init: the detected language is not always announced as a change at startup.
const syncLanguage = (lng: string) => {
  document.documentElement.lang = lng;
  setSharedCookie('sc-lang', lng.slice(0, 2));
};
i18n.on('languageChanged', syncLanguage);
void initialised.then(() => syncLanguage(i18n.language));

export default i18n;
