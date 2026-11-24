import { Body1, Button, Caption1, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Copy20Regular, Link24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { getApiBaseUrl, getGatewayBaseUrl } from '../lib/gateway';
import { useToast } from './feedback/useToast';
import { GLASS } from '../theme/glass';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  head: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground2 },
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalXL,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  icon: { display: 'inline-flex', color: tokens.colorBrandForeground1 },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  code: {
    flexGrow: 1,
    minWidth: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    ...GLASS.well,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    wordBreak: 'break-all',
  },
});

/** The two addresses a client needs: the gateway (OpenAI format, for API keys) and the control plane API. */
export function Endpoints({ bare = false }: { bare?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const items = [
    { key: 'gateway', url: getGatewayBaseUrl() },
    { key: 'api', url: getApiBaseUrl() },
  ] as const;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('endpoints.copied'));
    } catch {
      toast.error(t('endpoints.copyFailed'));
    }
  };

  return (
    <section className={styles.root}>
      {!bare && (
        <div className={styles.head}>
          <Text weight="semibold" size={500}>
            {t('endpoints.title')}
          </Text>
          <Body1 className={styles.muted}>{t('endpoints.body')}</Body1>
        </div>
      )}
      <div className={styles.grid}>
        {items.map(({ key, url }) => (
          <article key={key} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.icon}>
                <Link24Regular />
              </span>
              <Text weight="semibold" size={400}>
                {t(`endpoints.${key}.title`)}
              </Text>
            </div>
            <Caption1 className={styles.muted}>{t(`endpoints.${key}.body`)}</Caption1>
            <div className={styles.row}>
              <code className={styles.code}>{url}</code>
              <Button
                icon={<Copy20Regular />}
                aria-label={`${t('endpoints.copy')}: ${t(`endpoints.${key}.title`)}`}
                onClick={() => void copy(url)}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
