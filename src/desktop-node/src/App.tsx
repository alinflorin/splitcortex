import { makeStyles, tokens } from '@fluentui/react-components';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { JoinCard } from './components/JoinCard';
import { LogsCard } from './components/LogsCard';
import { NodeCard } from './components/NodeCard';
import { SettingsCard } from './components/SettingsCard';
import { PageHeader } from './components/PageHeader';
import { TopBar } from './components/TopBar';
import { UpdateCard } from './components/UpdateCard';
import { useEnrollment } from './enrollment/store';
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
});

export function App() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { enrollment, reload } = useEnrollment();

  // A node that was serving resumes when the page is opened again (unless the user turned that off).
  useEffect(() => {
    if (!enrollment?.approved) return;
    let alive = true;
    void loadSettings().then((s) => {
      if (alive && s.connectOnStart) void runtime.start();
    });
    return () => {
      alive = false;
    };
  }, [enrollment?.approved]);

  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.main}>
        <PageHeader eyebrow="SplitCortex" title={t('app.desktopNode')} subtitle={t('app.intro')} />
        {enrollment === undefined ? null : enrollment === null ? (
          <JoinCard onJoined={reload} />
        ) : (
          <>
            <NodeCard enrollment={enrollment} onChanged={reload} />
            <SettingsCard />
            <UpdateCard />
            <LogsCard />
          </>
        )}
      </main>
    </div>
  );
}
