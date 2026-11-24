import { useState } from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStoredBoolean } from '../../lib/useStoredBoolean';
import { Analytics } from '../../analytics/Analytics';
import { ConsentBanner } from '../../analytics/ConsentBanner';
import { LocaleSync } from '../../seo/LocaleSync';
import { parsePublicPath } from '../../seo/pages';
import { BRAND_BACKDROP } from '../../theme/brand';
import { Seo } from '../../seo/Seo';
import { Breadcrumbs } from './Breadcrumbs';
import { Sidebar } from './Sidebar';
import { SiteFooter } from './SiteFooter';
import { TopBar } from './TopBar';

const useStyles = makeStyles({
  // Exactly one viewport tall: the top bar and the sidebar stay put, only the page scrolls.
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    overflow: 'hidden',
    position: 'relative',
    isolation: 'isolate',
  },
  // Something to see through the glass: aurora glows over a faint dot grid, behind every page.
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: -1,
    pointerEvents: 'none',
    backgroundImage: BRAND_BACKDROP,
    backgroundSize: 'auto, auto, 28px 28px',
    backgroundRepeat: 'no-repeat, no-repeat, repeat',
  },
  body: { display: 'flex', flexGrow: 1, minHeight: 0 },
  scroll: { flexGrow: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  // One content width for every page; pages fill it (forms keep their own narrower column).
  // Home is full width: it lays out its own column so the tour can span the screen.
  mainFull: { maxWidth: 'none', padding: 0 },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '1280px',
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
  const publicPage = parsePublicPath(pathname);
  const [collapsed, setCollapsed] = useStoredBoolean('sc-sidebar-collapsed');
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} aria-hidden="true" />
      <Seo />
      <LocaleSync />
      <Analytics />
      <ConsentBanner />
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
          <main
            className={mergeClasses(
              styles.main,
              publicPage?.page.key === 'home' && styles.mainFull,
            )}
          >
            <Breadcrumbs />
            <div key={pathname} className="sc-enter">
              <Outlet />
            </div>
          </main>
          {publicPage && <SiteFooter />}
        </div>
      </div>
    </div>
  );
}
