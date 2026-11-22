import { useState } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStoredBoolean } from '../../lib/useStoredBoolean';
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
  },
  // One content width for every app page; pages fill it (forms keep their own narrower column).
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

/** The signed-in app: a sidebar (collapsible to an icon rail) next to the page. */
export function AppLayout() {
  const styles = useStyles();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // Desktop: inline sidebar, expanded or an icon rail (remembered). Below 1024px: an overlay drawer, hidden at first.
  const [collapsed, setCollapsed] = useStoredBoolean('sc-sidebar-collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={styles.root}>
      <Sidebar
        open={isDesktop || mobileOpen}
        overlay={!isDesktop}
        onOpenChange={setMobileOpen}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
      />
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
