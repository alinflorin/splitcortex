import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { GradientText } from '../components/marketing/marketing';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    padding: '80px 24px',
    borderRadius: '32px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  code: {
    fontSize: '96px',
    lineHeight: '96px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.04em',
  },
  muted: { color: tokens.colorNeutralForeground2 },
});

export function NotFound() {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <section className={styles.root}>
      <span className={styles.code}>
        <GradientText>404</GradientText>
      </span>
      <Text size={600} weight="semibold">
        {t('notFound.title')}
      </Text>
      <Text className={styles.muted}>{t('notFound.body')}</Text>
      <Link to="/">
        <Button appearance="primary">{t('notFound.home')}</Button>
      </Link>
    </section>
  );
}
