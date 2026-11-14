import type { MouseEvent } from 'react';
import {
  NavDrawer,
  NavDrawerBody,
  NavItem,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Building24Filled,
  Building24Regular,
  Home24Filled,
  Home24Regular,
  Info24Filled,
  Info24Regular,
  Settings24Filled,
  Settings24Regular,
  bundleIcon,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { OrgNav } from './OrgNav';

const HomeIcon = bundleIcon(Home24Filled, Home24Regular);
const OrgIcon = bundleIcon(Building24Filled, Building24Regular);
const InfoIcon = bundleIcon(Info24Filled, Info24Regular);
const SettingsIcon = bundleIcon(Settings24Filled, Settings24Regular);

const ITEMS = [
  { to: '/', key: 'home', Icon: HomeIcon },
  { to: '/organisations', key: 'organisations', Icon: OrgIcon },
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
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
  },
  logo: { width: '36px', height: '36px' },
  brand: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightRegular,
    textTransform: 'lowercase',
  },
  brandSplit: { color: '#14b8d4' },
  brandCortex: { color: '#4f5df0' },
  body: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}` },
});

interface SidebarProps {
  open: boolean;
  overlay: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The sidebar item an organisation URL belongs to (a node belongs to Pools). */
const sectionOf = (pathname: string) => {
  const seg = pathname.split('/')[3];
  return !seg || seg === 'nodes' ? 'pools' : seg;
};

export function Sidebar({ open, overlay, onOpenChange }: SidebarProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Inside an organisation the sidebar shows only that organisation's pages.
  const orgId = matchPath('/organisations/:orgId/*', pathname)?.params.orgId;
  const selected = orgId
    ? `/organisations/${orgId}/${sectionOf(pathname)}`
    : ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))?.to;

  const go = (to: string) => (e: MouseEvent) => {
    // Let the browser handle modified clicks (new tab etc.), route everything else client-side.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
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
      <div className={styles.header}>
        <img src="/logo.svg" alt="" className={styles.logo} />
        <Text className={styles.brand}>
          <span className={styles.brandSplit}>split</span>
          <span className={styles.brandCortex}>cortex</span>
        </Text>
      </div>
      <NavDrawerBody className={styles.body}>
        {orgId ? (
          // Inside an organisation the sidebar is only about that organisation.
          <OrgNav orgId={orgId} go={go} />
        ) : (
          ITEMS.map(({ to, key, Icon }) => (
            <NavItem key={to} value={to} href={to} icon={<Icon />} onClick={go(to)}>
              {t(`nav.${key}`)}
            </NavItem>
          ))
        )}
      </NavDrawerBody>
    </NavDrawer>
  );
}
