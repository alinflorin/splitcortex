import type { MouseEvent } from 'react';
import { NavDivider, NavItem } from '@fluentui/react-components';
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

interface OrgNavProps {
  orgId: string;
  go: (to: string) => (e: MouseEvent) => void;
}

/** Sidebar content for the organisation in the URL: a back item plus its pages. */
export function OrgNav({ orgId, go }: OrgNavProps) {
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
      <NavDivider />
      {items.map(({ to, key, Icon }) => (
        <NavItem key={to} value={to} href={to} icon={<Icon />} onClick={go(to)}>
          {t(`orgNav.${key}`)}
        </NavItem>
      ))}
    </>
  );
}
