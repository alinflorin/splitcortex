import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';

export default function Home() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Card>
        <Text variant="title">{t('home.title')}</Text>
        <Text muted>{t('home.subtitle')}</Text>
        <Text variant="caption" muted>
          {t('home.status')}
        </Text>
        <Button appearance="primary" label={t('home.enroll')} />
      </Card>
      <Link href="/settings" asChild>
        <Button label={t('nav.settings')} />
      </Link>
    </Screen>
  );
}
