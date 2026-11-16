import {
  Button,
  MessageBar,
  MessageBarBody,
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../lib/config';
import { inTauri } from '../native/ipc';
import { autostart, checkForUpdate, type PendingUpdate } from '../native/updater';
import { Panel } from './Panel';

const useStyles = makeStyles({
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
});

type Status = 'idle' | 'checking' | 'upToDate' | 'installing' | 'failed';

/** The app itself: its version, updates (checked once at start, signed releases from GitHub) and start at login. */
export function UpdateCard() {
  const styles = useStyles();
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [login, setLogin] = useState<boolean | undefined>(undefined);

  const check = async () => {
    setStatus('checking');
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      setStatus(u ? 'idle' : 'upToDate');
    } catch {
      setStatus('failed');
    }
  };

  useEffect(() => {
    if (!inTauri()) return;
    void check();
    void autostart()
      .then((a) => a.isEnabled())
      .then(setLogin)
      .catch(() => setLogin(undefined));
  }, []);

  if (!inTauri()) return null;

  const install = async () => {
    if (!update) return;
    setStatus('installing');
    try {
      await update.install();
    } catch {
      setStatus('failed');
    }
  };

  return (
    <Panel title={t('app.title')}>
      <div className={styles.stack}>
        <Text className={styles.muted}>{t('app.version', { version: APP_VERSION })}</Text>
        {update && (
          <MessageBar intent="info">
            <MessageBarBody>{t('app.updateAvailable', { version: update.version })}</MessageBarBody>
          </MessageBar>
        )}
        {status === 'failed' && (
          <MessageBar intent="warning">
            <MessageBarBody>{t('app.updateFailed')}</MessageBarBody>
          </MessageBar>
        )}
        {status === 'upToDate' && <Text className={styles.muted}>{t('app.upToDate')}</Text>}
        <div className={styles.row}>
          {update ? (
            <Button
              appearance="primary"
              disabled={status === 'installing'}
              onClick={() => void install()}
            >
              {status === 'installing' ? t('app.installing') : t('app.install')}
            </Button>
          ) : (
            <Button disabled={status === 'checking'} onClick={() => void check()}>
              {t('app.check')}
            </Button>
          )}
        </div>
        {login !== undefined && (
          <Switch
            checked={login}
            label={t('app.startAtLogin')}
            onChange={(_, d) => {
              setLogin(d.checked);
              void autostart().then((a) => (d.checked ? a.enable() : a.disable()));
            }}
          />
        )}
      </div>
    </Panel>
  );
}
