import { Card, CardHeader, Text, Title1, makeStyles, tokens } from '@fluentui/react-components';
import { BrainCircuit24Regular, PhoneLaptop24Regular, PlugConnected24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '../auth/useCurrentUser';

const useStyles = makeStyles({
  hero: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxWidth: '680px', paddingBottom: tokens.spacingVerticalXXXL },
  welcome: { color: tokens.colorBrandForeground1 },
  subtitle: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase500, fontSize: tokens.fontSizeBase400 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: tokens.spacingHorizontalXL },
  card: {
    padding: tokens.spacingVerticalXL,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'none',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  icon: { color: tokens.colorBrandForeground1, display: 'flex' },
});

export function Home() {
  const styles = useStyles();
  const { t } = useTranslation();
  const user = useCurrentUser();

  const cards = [
    { key: 'pools', icon: <BrainCircuit24Regular /> },
    { key: 'nodes', icon: <PhoneLaptop24Regular /> },
    { key: 'api', icon: <PlugConnected24Regular /> },
  ] as const;

  return (
    <>
      <section className={styles.hero}>
        {user && <Text className={styles.welcome} weight="semibold">{t('home.welcome', { name: user.name })}</Text>}
        <Title1>{t('home.title')}</Title1>
        <Text className={styles.subtitle}>{t('home.subtitle')}</Text>
      </section>
      <section className={styles.grid}>
        {cards.map(({ key, icon }) => (
          <Card key={key} className={styles.card}>
            <CardHeader
              image={<span className={styles.icon}>{icon}</span>}
              header={<Text weight="semibold" size={400}>{t(`home.cards.${key}.title`)}</Text>}
              description={<Text style={{ color: tokens.colorNeutralForeground2 }}>{t(`home.cards.${key}.body`)}</Text>}
            />
          </Card>
        ))}
      </section>
    </>
  );
}
