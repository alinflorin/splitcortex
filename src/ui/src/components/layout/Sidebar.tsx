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
import { PanelLeftContract20Regular, PanelLeftExpand20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useChartVersion } from '../../lib/useChartVersion';
import { useLocalePath } from '../../seo/useLocalePath';
import { GLOBAL_ITEMS } from './globalNav';
import { NavEntry } from './NavEntry';
import { OrgNav } from './OrgNav';

export const SIDEBAR_WIDTH = '232px';
export const SIDEBAR_RAIL_WIDTH = '56px';

const useStyles = makeStyles({
  drawer: {
    width: SIDEBAR_WIDTH,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  rail: { width: SIDEBAR_RAIL_WIDTH },
  body: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}` },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
  },
  footerRail: { justifyContent: 'center', padding: tokens.spacingVerticalS },
});

interface SidebarProps {
  open: boolean;
  /** Overlay drawer (narrow screens): also lists the top-level pages. Inline: only the organisation's pages. */
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

/**
 * Navigation inside an organisation (inline, desktop) or the whole menu (overlay, narrow screens).
 * The brand, the top-level links and the way back all live in the top bar and the breadcrumb.
 */
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
  const localePath = useLocalePath();
  const { pathname } = useLocation();
  const collapsed = collapsedProp && !overlay;

  const orgId = matchPath('/organisations/:orgId/*', pathname)?.params.orgId;
  const globalSelected = GLOBAL_ITEMS.map((i) => localePath(i.to)).find((to, n) =>
    GLOBAL_ITEMS[n]?.to === '/' ? pathname === to : pathname.startsWith(to),
  );
  const selected = orgId ? `/organisations/${orgId}/${sectionOf(pathname)}` : globalSelected;
  const showGlobal = !orgId || overlay;

  const go = (to: string) => (e: MouseEvent) => {
    // Let the browser handle modified clicks (new tab etc.), route everything else client-side.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    void navigate(to);
    if (overlay) onOpenChange(false);
  };

  const toggleLabel = t(collapsed ? 'nav.expand' : 'nav.collapse');

  return (
    <NavDrawer
      open={open}
      type={overlay ? 'overlay' : 'inline'}
      selectedValue={selected}
      onOpenChange={(_, data) => onOpenChange(data.open)}
      className={mergeClasses(styles.drawer, collapsed && styles.rail)}
    >
      <NavDrawerBody className={styles.body}>
        {orgId && <OrgNav orgId={orgId} go={go} collapsed={collapsed} />}
        {orgId && showGlobal && <NavDivider />}
        {showGlobal &&
          GLOBAL_ITEMS.map(({ to, key, Icon }) => (
            <NavEntry
              key={to}
              to={localePath(to)}
              label={t(`nav.${key}`)}
              icon={<Icon />}
              collapsed={collapsed}
              onClick={go(localePath(to))}
            />
          ))}
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
