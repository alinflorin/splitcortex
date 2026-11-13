import type { MouseEvent } from 'react';
import {
  NavDrawer,
  NavDrawerBody,
  NavDrawerHeader,
  NavItem,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Home24Filled,
  Home24Regular,
  Info24Filled,
  Info24Regular,
  Settings24Filled,
  Settings24Regular,
  bundleIcon,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

const HomeIcon = bundleIcon(Home24Filled, Home24Regular);
const InfoIcon = bundleIcon(Info24Filled, Info24Regular);
const SettingsIcon = bundleIcon(Settings24Filled, Settings24Regular);

const ITEMS = [
  { to: '/', key: 'home', Icon: HomeIcon },
  { to: '/about', key: 'about', Icon: InfoIcon },
  { to: '/settings', key: 'settings', Icon: SettingsIcon },
] as const;

const useStyles = makeStyles({
  drawer: {
    width: '264px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '64px',
    padding: `0 ${tokens.spacingHorizontalL}`,
  },
  logo: { width: '32px', height: '32px' },
  brand: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  body: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}` },
});

interface SidebarProps {
  open: boolean;
  overlay: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Sidebar({ open, overlay, onOpenChange }: SidebarProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const selected = ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))?.to;

  const go = (to: string) => (e: MouseEvent) => {
    // Let the browser handle modified clicks (new tab etc.), route everything else client-side.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate(to);
    if (overlay) onOpenChange(false);
  };

  return (
    <NavDrawer
      open={open}
      type={overlay ? 'overlay' : 'inline'}
      selectedValue={selected}
      onOpenChange={(_, data) => onOpenChange(data.open)}
      className={styles.drawer}
    >
      <NavDrawerHeader className={styles.header}>
        <img src="/logo.svg" alt="" className={styles.logo} />
        <Text className={styles.brand}>{t('app.name')}</Text>
      </NavDrawerHeader>
      <NavDrawerBody className={styles.body}>
        {ITEMS.map(({ to, key, Icon }) => (
          <NavItem key={to} value={to} href={to} icon={<Icon />} onClick={go(to)}>
            {t(`nav.${key}`)}
          </NavItem>
        ))}
      </NavDrawerBody>
    </NavDrawer>
  );
}
