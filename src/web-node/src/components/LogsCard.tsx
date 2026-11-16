import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { runtime, useLogEntries } from '../runtime';
import { Panel } from './Panel';

const useStyles = makeStyles({
  list: {
    maxHeight: '320px',
    overflowY: 'auto',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  warn: { color: tokens.colorPaletteYellowForeground2 },
  error: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS },
});

/** States and counts only: prompts and completions are never logged. */
export function LogsCard() {
  const styles = useStyles();
  const { t } = useTranslation();
  const entries = useLogEntries();
  const recent = entries.slice(-100).reverse();
  return (
    <Panel
      title={t('logs.title')}
      side={
        <div className={styles.actions}>
          <Button
            size="small"
            disabled={entries.length === 0}
            onClick={() => void navigator.clipboard?.writeText(runtime.log.toText())}
          >
            {t('logs.copy')}
          </Button>
          <Button size="small" disabled={entries.length === 0} onClick={() => runtime.log.clear()}>
            {t('logs.clear')}
          </Button>
        </div>
      }
    >
      {recent.length === 0 ? (
        <Text className={styles.muted}>{t('logs.empty')}</Text>
      ) : (
        <div className={styles.list}>
          {recent.map((e) => (
            <div
              key={e.id}
              className={
                e.level === 'error' ? styles.error : e.level === 'warn' ? styles.warn : undefined
              }
            >
              {new Date(e.time).toLocaleTimeString()} {e.message}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
