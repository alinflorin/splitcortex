import { Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { DividedList } from '../components/marketing/marketing';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
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
      <PageHeader title={t(`legal.${kind}.title`)} subtitle={t(`legal.${kind}.subtitle`)} />
      <div className={styles.root}>
        <Text size={200} className={styles.updated}>
          {t('legal.updated')}
        </Text>
        <DividedList
          items={sections.map((x, i) => ({ title: `${i + 1}. ${x.title}`, body: x.body }))}
        />
      </div>
    </>
  );
}

export const Terms = () => <LegalPage kind="terms" />;
export const Privacy = () => <LegalPage kind="privacy" />;
