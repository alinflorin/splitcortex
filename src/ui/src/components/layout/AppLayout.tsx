import { useState } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const useStyles = makeStyles({
  // The shell is exactly one viewport tall; only the content column scrolls, so the sidebar stays put.
  root: {
    display: 'flex',
    height: '100dvh',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: 'auto',
    backgroundImage:
      'radial-gradient(900px 360px at 85% -80px, rgba(79,93,240,0.09), transparent 70%), radial-gradient(700px 320px at 10% -60px, rgba(20,184,212,0.08), transparent 70%)',
    backgroundRepeat: 'no-repeat',
  },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '1120px',
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXXL}`,
    '@media (max-width: 599px)': {
      padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}`,
    },
  },
});

export function AppLayout() {
  const styles = useStyles();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  // Desktop: the sidebar is always visible. Mobile: an overlay drawer that starts hidden.
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={styles.root}>
      <Sidebar open={isDesktop || mobileOpen} overlay={!isDesktop} onOpenChange={setMobileOpen} />
      <div className={styles.column}>
        <TopBar showNavToggle={!isDesktop} onToggleNav={() => setMobileOpen((o) => !o)} />
        <main className={styles.main}>
          <div key={pathname} className="sc-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
