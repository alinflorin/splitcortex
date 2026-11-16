import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
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

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
