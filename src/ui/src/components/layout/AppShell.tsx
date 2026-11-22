import { useState } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStoredBoolean } from '../../lib/useStoredBoolean';
import { Breadcrumbs } from './Breadcrumbs';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const useStyles = makeStyles({
  // Exactly one viewport tall: the top bar and the sidebar stay put, only the page scrolls.
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  body: { display: 'flex', flexGrow: 1, minHeight: 0 },
  scroll: { flexGrow: 1, minWidth: 0, overflowY: 'auto' },
  // One content width for every page; pages fill it (forms keep their own narrower column).
  main: {
    width: '100%',
    maxWidth: '1120px',
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXXL} ${tokens.spacingVerticalXXXL}`,
    '@media (max-width: 599px)': {
      padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXL}`,
    },
  },
});

/**
 * The one layout of the whole site: top bar, breadcrumb, page. The sidebar exists only inside an
 * organisation (inline on desktop; below 1024 px a drawer from the top bar with every link).
 */
export function AppShell() {
  const styles = useStyles();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const inOrg = !!matchPath('/organisations/:orgId/*', pathname);
  const [collapsed, setCollapsed] = useStoredBoolean('sc-sidebar-collapsed');
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={styles.root}>
      <TopBar showNavToggle={!isDesktop} onToggleNav={() => setDrawerOpen((o) => !o)} />
      <div className={styles.body}>
        {isDesktop && inOrg && (
          <Sidebar
            open
            overlay={false}
            onOpenChange={() => undefined}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
          />
        )}
        {!isDesktop && <Sidebar open={drawerOpen} overlay onOpenChange={setDrawerOpen} />}
        <div className={styles.scroll}>
          <main className={styles.main}>
            <Breadcrumbs />
            <div key={pathname} className="sc-enter">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
