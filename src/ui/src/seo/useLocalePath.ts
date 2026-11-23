import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toLanguage } from '../i18n/languages';
import { localizedPath } from './pages';

/** Turns a link to a public page (`/about`) into the one for the current language (`/ro/about`); other paths stay. */
export function useLocalePath(): (path: string) => string {
  const { i18n } = useTranslation();
  const lng = toLanguage(i18n.resolvedLanguage);
  return useCallback((path: string) => localizedPath(path, lng), [lng]);
}
