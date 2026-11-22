import type { MouseEvent } from 'react';
import {
  Button,
  NavDivider,
  NavDrawer,
  NavDrawerBody,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  Building24Filled,
  Building24Regular,
  Chat24Filled,
  Chat24Regular,
  Home24Filled,
  Home24Regular,
  Info24Filled,
  Info24Regular,
  Mail24Filled,
  Mail24Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  bundleIcon,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useChartVersion } from '../../lib/useChartVersion';
import { NavEntry } from './NavEntry';
import { OrgNav } from './OrgNav';

const OrgIcon = bundleIcon(Building24Filled, Building24Regular);
const ChatIcon = bundleIcon(Chat24Filled, Chat24Regular);
const HomeIcon = bundleIcon(Home24Filled, Home24Regular);
const InfoIcon = bundleIcon(Info24Filled, Info24Regular);
const MailIcon = bundleIcon(Mail24Filled, Mail24Regular);

const ITEMS = [
  { to: '/organisations', key: 'organisations', Icon: OrgIcon },
  { to: '/playground', key: 'playground', Icon: ChatIcon },
] as const;

// The public site (it has its own header): a second group so the way back is always in reach.
const PUBLIC_ITEMS = [
  { to: '/', key: 'home', Icon: HomeIcon },
  { to: '/about', key: 'about', Icon: InfoIcon },
  { to: '/contact', key: 'contact', Icon: MailIcon },
] as const;

export const SIDEBAR_WIDTH = '232px';
export const SIDEBAR_RAIL_WIDTH = '56px';

const useStyles = makeStyles({
  drawer: {
    width: SIDEBAR_WIDTH,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  rail: { width: SIDEBAR_RAIL_WIDTH },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '64px',
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    textDecorationLine: 'none',
  },
  headerRail: { justifyContent: 'center', paddingLeft: 0, paddingRight: 0 },
  logo: { width: '36px', height: '36px' },
  brand: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightRegular,
    textTransform: 'lowercase',
  },
  brandSplit: { color: '#14b8d4' },
  brandCortex: { color: '#4f5df0' },
  body: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}` },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  footerRail: { justifyContent: 'center', padding: tokens.spacingVerticalS },
});

interface SidebarProps {
  open: boolean;
  overlay: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inline sidebar shrunk to an icon rail. Ignored in the overlay drawer. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** The sidebar item an organisation URL belongs to (a node belongs to Pools). */
const sectionOf = (pathname: string) => {
  const seg = pathname.split('/')[3];
  return !seg || seg === 'nodes' ? 'pools' : seg;
};

export function Sidebar({
  open,
  overlay,
  onOpenChange,
  collapsed: collapsedProp = false,
  onToggleCollapsed,
}: SidebarProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const version = useChartVersion();
  const { pathname } = useLocation();
  const collapsed = collapsedProp && !overlay;

  // Inside an organisation the sidebar shows only that organisation's pages.
  const orgId = matchPath('/organisations/:orgId/*', pathname)?.params.orgId;
  const selected = orgId
    ? `/organisations/${orgId}/${sectionOf(pathname)}`
    : ITEMS.find((i) => pathname.startsWith(i.to))?.to;

  // `keepOpen`: navigate without closing the overlay drawer (e.g. the back item, so the
  // top-level menu is visible right after leaving an organisation).
  const go =
    (to: string, keepOpen = false) =>
    (e: MouseEvent) => {
      // Let the browser handle modified clicks (new tab etc.), route everything else client-side.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      e.preventDefault();
      void navigate(to);
      if (overlay && !keepOpen) onOpenChange(false);
    };

  const brand = (
    <Link
      to="/"
      className={mergeClasses(styles.header, collapsed && styles.headerRail)}
      aria-label="SplitCortex"
    >
      <img src="/logo.svg" alt="" className={styles.logo} />
      {!collapsed && (
        <Text className={styles.brand}>
          <span className={styles.brandSplit}>split</span>
          <span className={styles.brandCortex}>cortex</span>
        </Text>
      )}
    </Link>
  );

  const toggleLabel = t(collapsed ? 'nav.expand' : 'nav.collapse');

  return (
    <NavDrawer
      open={open}
      type={overlay ? 'overlay' : 'inline'}
      selectedValue={selected}
      onOpenChange={(_, data) => onOpenChange(data.open)}
      className={mergeClasses(styles.drawer, collapsed && styles.rail)}
    >
      {!overlay && brand}
      <NavDrawerBody className={styles.body}>
        {orgId ? (
          // Inside an organisation the sidebar is only about that organisation.
          <OrgNav orgId={orgId} go={go} collapsed={collapsed} />
        ) : (
          <>
            {ITEMS.map(({ to, key, Icon }) => (
              <NavEntry
                key={to}
                to={to}
                label={t(`nav.${key}`)}
                icon={<Icon />}
                collapsed={collapsed}
                onClick={go(to)}
              />
            ))}
            <NavDivider />
            {PUBLIC_ITEMS.map(({ to, key, Icon }) => (
              <NavEntry
                key={to}
                to={to}
                label={t(`nav.${key}`)}
                icon={<Icon />}
                collapsed={collapsed}
                onClick={go(to)}
              />
            ))}
          </>
        )}
      </NavDrawerBody>
      <div className={mergeClasses(styles.footer, collapsed && styles.footerRail)}>
        {!collapsed && version && <Text size={200}>{t('app.version', { version })}</Text>}
        {!overlay && onToggleCollapsed && (
          <Tooltip content={toggleLabel} relationship="label" positioning="after">
            <Button
              appearance="subtle"
              size="small"
              icon={collapsed ? <PanelLeftExpand20Regular /> : <PanelLeftContract20Regular />}
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
            />
          </Tooltip>
        )}
      </div>
    </NavDrawer>
  );
}
