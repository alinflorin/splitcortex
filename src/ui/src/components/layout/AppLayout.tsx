import { useState } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const useStyles = makeStyles({
  root: { display: 'flex', minHeight: '100dvh', backgroundColor: tokens.colorNeutralBackground1 },
  column: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '1040px',
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXXL}`,
    '@media (max-width: 599px)': { padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}` },
  },
});

export function AppLayout() {
  const styles = useStyles();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  // Separate state per mode: on desktop the sidebar is open by default, on mobile it starts hidden.
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const open = isDesktop ? desktopOpen : mobileOpen;
  const setOpen = isDesktop ? setDesktopOpen : setMobileOpen;

  return (
    <div className={styles.root}>
      <Sidebar open={open} overlay={!isDesktop} onOpenChange={setOpen} />
      <div className={styles.column}>
        <TopBar onToggleNav={() => setOpen(!open)} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
