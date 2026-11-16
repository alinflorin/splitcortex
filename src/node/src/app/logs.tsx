import { Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { runtime, useLogs } from '../runtime';

const time = (ms: number) => new Date(ms).toLocaleTimeString();

export default function Logs() {
  const { t } = useTranslation();
  const logs = useLogs();
  return (
    <Screen>
      <Card>
        <Text variant="caption" muted>
          {t('logs.note')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={t('logs.share')}
            onPress={() => void Share.share({ message: runtime.log.toText() })}
          />
          <Button label={t('logs.clear')} onPress={() => runtime.log.clear()} />
        </View>
      </Card>
      <Card style={{ gap: 6 }}>
        {logs.length === 0 ? (
          <Text muted>{t('logs.empty')}</Text>
        ) : (
          [...logs].reverse().map((e) => (
            <Text
              key={e.id}
              variant="caption"
              style={e.level === 'error' ? { color: '#c4314b' } : undefined}
              muted={e.level === 'info'}
            >
              {time(e.time)} {e.message}
            </Text>
          ))
        )}
      </Card>
    </Screen>
  );
}
