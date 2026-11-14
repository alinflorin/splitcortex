import type { MouseEvent } from 'react';
import {
  Badge,
  Caption1,
  NavDivider,
  NavItem,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  DataTrendingRegular,
  BrainCircuitRegular,
  DeviceMeetingRoomRegular,
  PeopleRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useOrganisation } from '../../api/hooks';
import { isAdmin } from '../../lib/roles';

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
}

/** Sidebar content for the organisation in the URL: a back item plus its pages. */
export function OrgNav({ orgId, go }: OrgNavProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  // Same query (and cache entry) as the page itself, so the role never disagrees with the content.
  const { data: current } = useOrganisation(orgId);

  const base = `/organisations/${orgId}`;
  const items = [
    { to: `${base}/pools`, key: 'pools', Icon: DeviceMeetingRoomRegular },
    { to: `${base}/models`, key: 'models', Icon: BrainCircuitRegular },
    { to: `${base}/members`, key: 'members', Icon: PeopleRegular },
    { to: `${base}/usage`, key: 'usage', Icon: DataTrendingRegular },
    ...(current && isAdmin(current.role)
      ? [{ to: `${base}/settings`, key: 'settings', Icon: SettingsRegular }]
      : []),
  ];

  return (
    <>
      <NavItem
        value="/organisations"
        href="/organisations"
        icon={<ArrowLeftRegular />}
        onClick={go('/organisations')}
      >
        {t('organisations.back')}
      </NavItem>
      {current && (
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
        <NavItem key={to} value={to} href={to} icon={<Icon />} onClick={go(to)}>
          {t(`orgNav.${key}`)}
        </NavItem>
      ))}
    </>
  );
}
