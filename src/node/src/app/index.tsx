import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { clearEnrollment, useEnrollment } from '../enrollment/store';

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const { enrollment, reload } = useEnrollment();
  useFocusEffect(useCallback(reload, [reload]));

  return (
    <Screen>
      <Card>
        <Text variant="title">{t('home.title')}</Text>
        <Text muted>{t('home.subtitle')}</Text>
        {enrollment ? (
          <>
            <Text>{t(enrollment.approved ? 'status.approved' : 'status.pending')}</Text>
            <Text variant="caption" muted>
              {t('status.fingerprint')}: {enrollment.fingerprint}
            </Text>
            <Button
              label={t('status.forget')}
              onPress={() => void clearEnrollment().then(reload)}
            />
            <Text variant="caption" muted>
              {t('status.forgetNote')}
            </Text>
          </>
        ) : (
          <>
            <Text variant="caption" muted>
              {t('home.status')}
            </Text>
            <Button
              appearance="primary"
              label={t('home.enroll')}
              onPress={() => router.push('/enroll')}
            />
          </>
        )}
      </Card>
      <Link href="/settings" asChild>
        <Button label={t('nav.settings')} />
      </Link>
    </Screen>
  );
}
