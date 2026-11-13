import { Text, Title1, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '680px',
  },
  text: {
    color: tokens.colorNeutralForeground2,
    lineHeight: tokens.lineHeightBase500,
    fontSize: tokens.fontSizeBase400,
  },
});

export function About() {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <div className={styles.root}>
      <Title1>{t('about.title')}</Title1>
      <Text className={styles.text}>{t('about.p1')}</Text>
      <Text className={styles.text}>{t('about.p2')}</Text>
      <Text className={styles.text}>{t('about.p3')}</Text>
    </div>
  );
}
