import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ro from './locales/ro.json';

export const LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof LANGUAGES)[number];
const STORAGE_KEY = 'sc-lng';

function deviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode;
  return LANGUAGES.find((l) => l === code) ?? 'en';
}

// Translations are bundled (no HTTP like the web app); stored choice, then device, fallback en.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ro: { translation: ro } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
  const lng = LANGUAGES.find((l) => l === stored);
  if (lng) void i18n.changeLanguage(lng);
});

export function setLanguage(lng: Language) {
  void i18n.changeLanguage(lng);
  void AsyncStorage.setItem(STORAGE_KEY, lng);
}

export default i18n;
