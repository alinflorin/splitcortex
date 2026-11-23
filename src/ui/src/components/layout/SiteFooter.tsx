import { Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, toLanguage } from '../../i18n/languages';
import { PUBLIC_PAGES, localizedPath, parsePublicPath } from '../../seo/pages';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}`,
    width: '100%',
    maxWidth: '1280px',
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXXXL}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    color: tokens.colorNeutralForeground3,
    '@media (max-width: 599px)': {
      padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    },
  },
  group: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
  },
  link: {
    color: tokens.colorNeutralForeground2,
    textDecorationLine: 'none',
    ':hover': { color: tokens.colorBrandForeground1, textDecorationLine: 'underline' },
  },
  current: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
});

/**
 * The same links on every public page: the pages themselves (so crawlers and visitors reach all of them from any
 * page, the legal pages included) and the page in the other languages (plain links, with hreflang).
 */
export function SiteFooter() {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const current = toLanguage(i18n.resolvedLanguage);
  const page = parsePublicPath(pathname)?.page;

  return (
    <footer className={styles.root}>
      <Text size={200}>{t('footer.rights', { year: new Date().getFullYear() })}</Text>
      <nav className={styles.group} aria-label={t('footer.nav')}>
        {PUBLIC_PAGES.map((p) => (
          <Link key={p.key} to={localizedPath(p.path, current)} className={styles.link}>
            <Text size={200}>
              {t(
                p.key === 'home'
                  ? 'nav.home'
                  : p.key === 'about' || p.key === 'contact'
                    ? `nav.${p.key}`
                    : `legal.${p.key}.title`,
              )}
            </Text>
          </Link>
        ))}
      </nav>
      <nav className={styles.group} aria-label={t('footer.language')}>
        {SUPPORTED_LANGUAGES.map((l) => (
          <Link
            key={l}
            to={localizedPath(page?.path ?? '/', l)}
            hrefLang={l}
            lang={l}
            className={l === current ? `${styles.link} ${styles.current}` : styles.link}
            aria-current={l === current ? 'true' : undefined}
          >
            <Text size={200}>{t(`language.${l}`, { lng: l })}</Text>
          </Link>
        ))}
      </nav>
    </footer>
  );
}
