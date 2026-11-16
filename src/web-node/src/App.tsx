import { MessageBar, MessageBarBody, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JoinCard } from './components/JoinCard';
import { LogsCard } from './components/LogsCard';
import { NodeCard } from './components/NodeCard';
import { SettingsCard } from './components/SettingsCard';
import { TopBar } from './components/TopBar';
import { codeFromHash } from './enrollment/link';
import { useEnrollment } from './enrollment/store';
import { opfsSupported } from './models/files';
import { runtime } from './runtime';
import { loadSettings } from './runtime/settings';

const useStyles = makeStyles({
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  main: {
    width: '100%',
    maxWidth: '880px',
    boxSizing: 'border-box',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXL}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    '@media (max-width: 599px)': {
      padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalM}`,
    },
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** The code the link carried, read once; the fragment is then removed so the code does not stay in the history. */
function takeJoinCode(): string {
  const code = codeFromHash(window.location.hash);
  if (window.location.hash)
    history.replaceState(null, '', window.location.pathname + window.location.search);
  return code;
}

export function App() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { enrollment, reload } = useEnrollment();
  const [joinCode] = useState(takeJoinCode);
  const supported = opfsSupported();
  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  // A node that was serving resumes when the page is opened again (unless the user turned that off).
  useEffect(() => {
    if (!enrollment?.approved || !supported) return;
    let alive = true;
    void loadSettings().then((s) => {
      if (alive && s.connectOnStart) void runtime.start();
    });
    return () => {
      alive = false;
    };
  }, [enrollment?.approved, supported]);

  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.main}>
        <Text className={styles.muted}>{t('app.intro')}</Text>
        {!supported && (
          <MessageBar intent="error">
            <MessageBarBody>{t('app.unsupported')}</MessageBarBody>
          </MessageBar>
        )}
        {supported && !hasGpu && (
          <MessageBar intent="warning">
            <MessageBarBody>{t('app.noWebGpu')}</MessageBarBody>
          </MessageBar>
        )}
        {enrollment === undefined ? null : enrollment === null ? (
          <JoinCard initialCode={joinCode} onJoined={reload} />
        ) : (
          <>
            <MessageBar intent="info">
              <MessageBarBody>{t('app.keepOpen')}</MessageBarBody>
            </MessageBar>
            <NodeCard enrollment={enrollment} onChanged={reload} />
            <SettingsCard />
            <LogsCard />
          </>
        )}
      </main>
    </div>
  );
}
