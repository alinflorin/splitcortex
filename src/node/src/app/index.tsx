import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryExemption } from '../components/BatteryExemption';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { runtime, useRuntime } from '../runtime';
import { clearEnrollment, useEnrollment } from '../enrollment/store';

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const { enrollment, reload } = useEnrollment();
  useFocusEffect(useCallback(reload, [reload]));
  const rt = useRuntime();

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
      {enrollment?.approved ? (
        <Card style={{ gap: 8 }}>
          <Text variant="subtitle">{t(rt.running ? 'home.running' : 'home.stopped')}</Text>
          {rt.blocked ? <Text muted>{t(`home.blocked.${rt.blocked}`)}</Text> : null}
          <Text>{t(`home.connection.${rt.connection}`)}</Text>
          <Text muted>
            {t('home.model')}:{' '}
            {rt.model.modelId
              ? `${rt.model.name} · ${t(`home.modelPhase.${rt.model.phase}`)}${
                  rt.model.phase === 'downloading' && rt.model.sizeBytes
                    ? ` ${Math.floor((rt.model.progressBytes / rt.model.sizeBytes) * 100)}%`
                    : ''
                }${rt.model.error ? ` (${rt.model.error})` : ''}`
              : t('home.modelNone')}
          </Text>
          {rt.backend ? (
            <Text variant="caption" muted>
              {t('home.engine', {
                backend: rt.backend.toUpperCase(),
                tokens: rt.maxContextTokens,
              })}
            </Text>
          ) : null}
          <Text variant="caption" muted>
            {t('home.served', { requests: rt.requestsServed, tokens: rt.tokensServed })}
          </Text>
          {rt.running ? (
            <>
              <Button label={t('home.restart')} onPress={() => void runtime.restart()} />
              <Button label={t('home.stop')} onPress={() => void runtime.stop()} />
            </>
          ) : (
            <Button
              appearance="primary"
              label={t('home.start')}
              onPress={() => void runtime.start()}
            />
          )}
        </Card>
      ) : null}
      {enrollment?.approved ? <BatteryExemption /> : null}
      <Link href="/logs" asChild>
        <Button label={t('home.logs')} />
      </Link>
      <Link href="/settings" asChild>
        <Button label={t('nav.settings')} />
      </Link>
    </Screen>
  );
}
