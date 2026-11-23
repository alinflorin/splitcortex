import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toLanguage } from '../i18n/languages';
import { languageOfPath, localizedPath, parsePublicPath } from './pages';

/** Dex sends the browser back to `/?code=...&state=...`; that visit must not be moved to another language's URL. */
const isSignInCallback = (search: string) => /[?&]code=/.test(search) && /[?&]state=/.test(search);

/**
 * Keeps the language and the URL of the public pages in step (`/about` is English, `/ro/about` is Romanian):
 *  - language -> URL: switching the language, or arriving at a bare URL with another language saved or detected, goes
 *    to the same page in that language;
 *  - URL -> language: back/forward and links to another language's URL switch the language.
 * Pages of the signed-in app have no language in their URL and are left alone.
 */
export function LocaleSync() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const language = toLanguage(i18n.resolvedLanguage);
  const mounted = useRef(false);

  const parsed = parsePublicPath(pathname);
  const urlLanguage = languageOfPath(pathname) ?? parsed?.lng ?? null;

  useEffect(() => {
    // The first render is covered by language detection (and by the effect below); this follows later navigation.
    if (!mounted.current) return;
    if (urlLanguage && urlLanguage !== toLanguage(i18n.resolvedLanguage)) {
      void i18n.changeLanguage(urlLanguage);
    }
    // only a change of URL, never a change of language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (!parsed || parsed.lng === language || isSignInCallback(search)) return;
    void navigate(
      { pathname: localizedPath(parsed.page.path, language), search, hash },
      { replace: first },
    );
    // only a change of language (or the first render), never a change of URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return null;
}
