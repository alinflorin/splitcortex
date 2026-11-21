import { Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '760px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  muted: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase400 },
  updated: { color: tokens.colorNeutralForeground3 },
});

interface LegalSection {
  title: string;
  body: string;
}

/** A static legal document: numbered section cards from `legal.<kind>.sections`. */
function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const sections = t(`legal.${kind}.sections`, { returnObjects: true }) as LegalSection[];
  return (
    <>
      <PageHeader
        eyebrow={t('legal.eyebrow')}
        title={t(`legal.${kind}.title`)}
        subtitle={t(`legal.${kind}.subtitle`)}
      />
      <div className={styles.root}>
        <Text size={200} className={styles.updated}>
          {t('legal.updated')}
        </Text>
        {sections.map((s, i) => (
          <article key={s.title} className={styles.card}>
            <Text weight="semibold" size={400}>
              {i + 1}. {s.title}
            </Text>
            <Text className={styles.muted}>{s.body}</Text>
          </article>
        ))}
      </div>
    </>
  );
}

export const Terms = () => <LegalPage kind="terms" />;
export const Privacy = () => <LegalPage kind="privacy" />;
