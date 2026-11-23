import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { applyHead, buildHead } from './head';

/** Keeps the document head (title, description, canonical, hreflang, Open Graph, robots) right for the current page. */
export function Seo() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  useEffect(() => {
    applyHead(buildHead({ pathname, origin: window.location.origin, t: (key) => t(key) }));
  }, [pathname, language, t]);
  return null;
}
