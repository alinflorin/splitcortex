import { Body1, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';

/** Where the node app can be downloaded. Empty URLs render the badge without a link for now. */
const LINKS = [
  {
    key: 'apk',
    image: '/badges/apk.svg',
    url: 'https://github.com/alinflorin/splitcortex/releases',
  },
  { key: 'play', image: '/badges/google-play.svg', url: '' },
  { key: 'ios', image: '/badges/app-store.svg', url: '' },
] as const;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  muted: { color: tokens.colorNeutralForeground2 },
  badges: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  badge: { display: 'block', height: '44px' },
});

/** Download badges for the node app (APK on GitHub Releases, Google Play, App Store). */
export function AppDownloads() {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <section className={styles.root}>
      <Text weight="semibold" size={400}>
        {t('apps.title')}
      </Text>
      <Body1 className={styles.muted}>{t('apps.body')}</Body1>
      <div className={styles.badges}>
        {LINKS.map(({ key, image, url }) => {
          const img = <img src={image} alt={t(`apps.${key}`)} className={styles.badge} />;
          return url ? (
            <a key={key} href={url} target="_blank" rel="noreferrer">
              {img}
            </a>
          ) : (
            <span key={key}>{img}</span>
          );
        })}
      </div>
    </section>
  );
}
