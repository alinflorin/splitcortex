import { Button, Link, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { useAnalyticsId } from './config';
import { setConsent, useConsent } from './consent';
import { GLASS } from '../theme/glass';

const useStyles = makeStyles({
  root: {
    position: 'fixed',
    zIndex: 1000,
    right: tokens.spacingHorizontalXL,
    bottom: tokens.spacingVerticalXL,
    left: tokens.spacingHorizontalXL,
    maxWidth: '520px',
    marginLeft: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    ...GLASS.panel,
    boxShadow: `${GLASS.panel.boxShadow}, ${tokens.shadow16}`,
    '@media (max-width: 599px)': {
      right: tokens.spacingHorizontalM,
      bottom: tokens.spacingVerticalM,
      left: tokens.spacingHorizontalM,
    },
  },
  body: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase300 },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
});

/** The privacy policy lives on the web app: `web-node.<domain>` -> `https://<domain>/privacy` (none on a plain host). */
export function privacyUrl(language: string, hostname = window.location.hostname): string | null {
  if (!hostname.startsWith('web-node.')) return null;
  return `https://${hostname.slice('web-node.'.length)}${language.startsWith('ro') ? '/ro' : ''}/privacy`;
}

/**
 * Asks once whether Google Analytics may run (production only: without a measurement id there is nothing to ask).
 * Accept and Decline look alike on purpose. "Cookie settings" in the menu asks again.
 * A copy of this lives in src/ui/src/analytics (the projects share no code).
 */
export function ConsentBanner() {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const id = useAnalyticsId();
  const { consent, asking } = useConsent();
  if (!id || (consent !== null && !asking)) return null;
  const privacy = privacyUrl(i18n.resolvedLanguage ?? 'en');

  return (
    <section
      className={styles.root}
      role="dialog"
      aria-modal="false"
      aria-label={t('consent.title')}
    >
      <Text weight="semibold" size={400}>
        {t('consent.title')}
      </Text>
      <Text className={styles.body}>{t('consent.body')}</Text>
      <div className={styles.actions}>
        <Button appearance="primary" onClick={() => setConsent('granted')}>
          {t('consent.accept')}
        </Button>
        <Button appearance="primary" onClick={() => setConsent('denied')}>
          {t('consent.decline')}
        </Button>
        {privacy && (
          <Link href={privacy} target="_blank" rel="noopener noreferrer">
            {t('consent.privacy')}
          </Link>
        )}
      </div>
    </section>
  );
}
