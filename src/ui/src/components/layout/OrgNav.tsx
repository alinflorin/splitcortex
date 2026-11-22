import type { MouseEvent } from 'react';
import { Badge, Caption1, NavDivider, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  KeyRegular,
  DataTrendingRegular,
  PulseRegular,
  HistoryRegular,
  BrainCircuitRegular,
  DeviceMeetingRoomRegular,
  PeopleRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useOrganisation } from '../../api/hooks';
import { isAdmin } from '../../lib/roles';
import { NavEntry } from './NavEntry';

const useStyles = makeStyles({
  // Context label, not a heading: the page's own title stays the only heading on screen.
  org: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    minWidth: 0,
  },
  name: { overflowWrap: 'anywhere', fontWeight: tokens.fontWeightSemibold },
  role: { alignSelf: 'flex-start' },
});

interface OrgNavProps {
  orgId: string;
  go: (to: string) => (e: MouseEvent) => void;
  collapsed?: boolean;
}

/** Sidebar content for the organisation in the URL: who it is, then its pages. The way back is the breadcrumb. */
export function OrgNav({ orgId, go, collapsed = false }: OrgNavProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  // Same query (and cache entry) as the page itself, so the role never disagrees with the content.
  const { data: current } = useOrganisation(orgId);

  const base = `/organisations/${orgId}`;
  const items = [
    { to: `${base}/models`, key: 'models', Icon: BrainCircuitRegular },
    { to: `${base}/pools`, key: 'pools', Icon: DeviceMeetingRoomRegular },
    ...(current && isAdmin(current.role)
      ? [{ to: `${base}/api-keys`, key: 'apiKeys', Icon: KeyRegular }]
      : []),
    { to: `${base}/members`, key: 'members', Icon: PeopleRegular },
    { to: `${base}/usage`, key: 'usage', Icon: DataTrendingRegular },
    { to: `${base}/metrics`, key: 'metrics', Icon: PulseRegular },
    ...(current && isAdmin(current.role)
      ? [{ to: `${base}/audit`, key: 'audit', Icon: HistoryRegular }]
      : []),
    ...(current && isAdmin(current.role)
      ? [{ to: `${base}/settings`, key: 'settings', Icon: SettingsRegular }]
      : []),
  ];

  return (
    <>
      {current && !collapsed && (
        <div className={styles.org} aria-label={t('orgNav.current')}>
          <Caption1>{t('orgNav.current')}</Caption1>
          <Text className={styles.name}>{current.name}</Text>
          <Badge appearance="tint" size="small" className={styles.role}>
            {t(`roles.${current.role}`)}
          </Badge>
        </div>
      )}
      <NavDivider />
      {items.map(({ to, key, Icon }) => (
        <NavEntry
          key={to}
          to={to}
          label={t(`orgNav.${key}`)}
          icon={<Icon />}
          collapsed={collapsed}
          onClick={go(to)}
        />
      ))}
    </>
  );
}
