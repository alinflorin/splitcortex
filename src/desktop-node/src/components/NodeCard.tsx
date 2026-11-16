import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refreshEnrollmentInfo } from '../enrollment/info';
import { resetIdentity } from '../enrollment/identity';
import { clearEnrollment, type StoredEnrollment } from '../enrollment/store';
import { formatBytes } from '../lib/format';
import { modelFiles, runtime, useRuntime } from '../runtime';
import { Panel, Stat, StatRow } from './Panel';

const useStyles = makeStyles({
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  muted: { color: tokens.colorNeutralForeground3 },
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

/** The connection / model / device card of an enrolled node, with start, stop and "remove this device". */
export function NodeCard({
  enrollment,
  onChanged,
}: {
  enrollment: StoredEnrollment;
  onChanged: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const rt = useRuntime();
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Names and approval come from the control plane; poll while the admin has not approved this device yet.
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void refreshEnrollmentInfo().then((e) => {
        if (
          alive &&
          e &&
          (e.approved !== enrollment.approved || e.poolName !== enrollment.poolName)
        )
          onChanged();
      });
    refresh();
    const timer = enrollment.approved ? undefined : setInterval(refresh, 10_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [enrollment.approved, enrollment.poolName, onChanged]);

  const leave = async () => {
    setConfirmLeave(false);
    await runtime.stop();
    for (const f of await modelFiles.list().catch(() => []))
      await modelFiles.remove(f).catch(() => undefined);
    await clearEnrollment();
    await resetIdentity();
    onChanged();
  };

  const model = rt.model;
  const dash = '–';
  const progress = model.sizeBytes > 0 ? model.progressBytes / model.sizeBytes : 0;

  return (
    <Panel
      title={enrollment.deviceName ?? t('node.title')}
      side={
        <Badge
          appearance="tint"
          color={rt.connection === 'connected' ? 'success' : rt.running ? 'warning' : 'informative'}
        >
          {t(`node.connection.${rt.connection}`)}
        </Badge>
      }
    >
      <div className={styles.stack}>
        {!enrollment.approved && (
          <MessageBar intent="info">
            <MessageBarBody>{t('node.notApproved')}</MessageBarBody>
          </MessageBar>
        )}
        {rt.blocked === 'no-gateway' && (
          <MessageBar intent="warning">
            <MessageBarBody>{t('node.noGateway')}</MessageBarBody>
          </MessageBar>
        )}
        {model.phase === 'failed' && (
          <MessageBar intent="error">
            <MessageBarBody>{t('node.modelFailed', { error: model.error ?? '' })}</MessageBarBody>
          </MessageBar>
        )}
        <StatRow>
          <Stat label={t('node.org')} value={enrollment.orgName ?? dash} />
          <Stat label={t('node.pool')} value={enrollment.poolName ?? dash} />
          <Stat label={t('node.fingerprint')} value={enrollment.fingerprint} />
          <Stat
            label={t('node.model')}
            value={
              model.phase === 'none' ? dash : `${model.name} · ${t(`node.phase.${model.phase}`)}`
            }
          />
          <Stat
            label={t('node.runsOn')}
            value={rt.backend ? `${rt.backend.toUpperCase()} · ${rt.maxContextTokens}` : dash}
          />
          <Stat label={t('node.requests')} value={rt.requestsServed} />
          <Stat label={t('node.tokens')} value={rt.tokensServed} />
          <Stat
            label={t('node.speed')}
            value={rt.tokensPerSec > 0 ? `${rt.tokensPerSec.toFixed(1)} tok/s` : dash}
          />
        </StatRow>
        {model.phase === 'downloading' && (
          <div>
            <ProgressBar value={progress} />
            <Text size={200} className={styles.muted}>
              {formatBytes(model.progressBytes)} / {formatBytes(model.sizeBytes)}
            </Text>
          </div>
        )}
        <div className={styles.actions}>
          {rt.running ? (
            <>
              <Button onClick={() => void runtime.restart()}>{t('node.restart')}</Button>
              <Button onClick={() => void runtime.stop()}>{t('node.stop')}</Button>
            </>
          ) : (
            <Button
              appearance="primary"
              disabled={!enrollment.approved}
              onClick={() => void runtime.start()}
            >
              {t('node.start')}
            </Button>
          )}
          <Button appearance="subtle" onClick={() => setConfirmLeave(true)}>
            {t('node.leave')}
          </Button>
        </div>
      </div>
      <Dialog open={confirmLeave} onOpenChange={(_, d) => !d.open && setConfirmLeave(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('node.leaveTitle')}</DialogTitle>
            <DialogContent>{t('node.leaveBody')}</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</Button>
              <Button appearance="primary" onClick={() => void leave()}>
                {t('node.leave')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Panel>
  );
}
