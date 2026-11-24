import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLocalePath } from '../seo/useLocalePath';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    padding: '96px 24px',
  },
  code: {
    fontSize: '96px',
    lineHeight: '96px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.04em',
    color: tokens.colorBrandForeground1,
  },
  muted: { color: tokens.colorNeutralForeground2 },
});

export function NotFound() {
  const styles = useStyles();
  const { t } = useTranslation();
  const localePath = useLocalePath();
  return (
    <section className={styles.root}>
      <span className={styles.code}>404</span>
      <Text as="h1" size={600} weight="semibold" style={{ margin: 0 }}>
        {t('notFound.title')}
      </Text>
      <Text className={styles.muted}>{t('notFound.body')}</Text>
      <Link to={localePath('/')}>
        <Button appearance="primary">{t('notFound.home')}</Button>
      </Link>
    </section>
  );
}
