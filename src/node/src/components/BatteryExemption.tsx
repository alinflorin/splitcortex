import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { nodeService } from '../native/nodeService';
import { Button } from './Button';
import { Card } from './Card';
import { Text } from './Text';

/** Whether the app is exempt from battery optimisation; re-read when the app comes back from the system dialog. */
export function useBatteryExempt() {
  const [exempt, setExempt] = useState<boolean | undefined>(undefined);
  const refresh = useCallback(() => void nodeService.batteryExempt().then(setExempt), []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return exempt;
}

/**
 * Doze: Android may freeze the network of a background app even with a foreground service, so the gateway connection
 * drops while the screen is off. Only the user can lift that (a system dialog), so the app asks. Shown while the app is
 * not exempt; `alwaysShow` (Settings) also shows the good state.
 */
export function BatteryExemption({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useTranslation();
  const exempt = useBatteryExempt();
  if (exempt === undefined || !nodeService.available) return null;
  if (exempt && !alwaysShow) return null;
  return (
    <Card style={{ gap: 8 }}>
      <Text variant="subtitle">{t('battery.title')}</Text>
      <Text muted>{t(exempt ? 'battery.ok' : 'battery.hint')}</Text>
      {exempt ? null : (
        <Button
          appearance="primary"
          label={t('battery.allow')}
          onPress={() => void nodeService.requestBatteryExemption()}
        />
      )}
    </Card>
  );
}
