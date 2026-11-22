import type { ReactNode } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { ChevronRight12Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { useNode, useOrganisation, usePool } from '../../api/hooks';

const useStyles = makeStyles({
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    listStyleType: 'none',
    margin: 0,
    marginBottom: tokens.spacingVerticalL,
    padding: 0,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  item: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  label: {
    maxWidth: '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '@media (max-width: 599px)': { maxWidth: '120px' },
  },
  link: {
    color: tokens.colorNeutralForeground2,
    textDecorationLine: 'none',
    ':hover': { color: tokens.colorBrandForeground1, textDecorationLine: 'underline' },
  },
  current: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
});

/** One step of the trail; the last one (no `to`) is the page you are on. */
function Crumb({ to, children, first }: { to?: string; children: ReactNode; first?: boolean }) {
  const styles = useStyles();
  return (
    <li className={styles.item}>
      {!first && <ChevronRight12Regular aria-hidden />}
      {to ? (
        <Link to={to} className={`${styles.label} ${styles.link}`}>
          {children}
        </Link>
      ) : (
        <span className={`${styles.label} ${styles.current}`} aria-current="page">
          {children}
        </span>
      )}
    </li>
  );
}

function OrgCrumb({ orgId, current }: { orgId: string; current?: boolean }) {
  const { data } = useOrganisation(orgId);
  return <Crumb to={current ? undefined : `/organisations/${orgId}`}>{data?.name ?? '…'}</Crumb>;
}

function PoolCrumb({
  orgId,
  poolId,
  current,
}: {
  orgId: string;
  poolId: string;
  current?: boolean;
}) {
  const { data } = usePool(orgId, poolId);
  return (
    <Crumb to={current ? undefined : `/organisations/${orgId}/pools/${poolId}`}>
      {data?.name ?? '…'}
    </Crumb>
  );
}

function NodeTrail({ orgId, nodeId }: { orgId: string; nodeId: string }) {
  const { t } = useTranslation();
  const { data: node } = useNode(orgId, nodeId);
  return (
    <>
      <Crumb to={`/organisations/${orgId}/pools`}>{t('orgNav.pools')}</Crumb>
      {node && <PoolCrumb orgId={orgId} poolId={node.poolId} />}
      <Crumb>{node?.name ?? '…'}</Crumb>
    </>
  );
}

const SECTION_KEYS: Record<string, string> = {
  models: 'models',
  pools: 'pools',
  'api-keys': 'apiKeys',
  members: 'members',
  usage: 'usage',
  metrics: 'metrics',
  audit: 'audit',
  settings: 'settings',
};

/** Where you are inside an organisation, and the way back up. Shown on organisation pages only. */
export function Breadcrumbs() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const match = matchPath('/organisations/:orgId/*', pathname);
  const orgId = match?.params.orgId;
  if (!orgId) return null;
  const [section = '', id] = (match.params['*'] ?? '').split('/').filter(Boolean);

  let trail: ReactNode = null;
  if (section === 'nodes' && id) trail = <NodeTrail orgId={orgId} nodeId={id} />;
  else if (section === 'pools' && id)
    trail = (
      <>
        <Crumb to={`/organisations/${orgId}/pools`}>{t('orgNav.pools')}</Crumb>
        <PoolCrumb orgId={orgId} poolId={id} current />
      </>
    );
  else if (SECTION_KEYS[section]) trail = <Crumb>{t(`orgNav.${SECTION_KEYS[section]}`)}</Crumb>;

  return (
    <nav aria-label={t('nav.breadcrumb')}>
      <ol className={styles.list}>
        <Crumb to="/organisations" first>
          {t('nav.organisations')}
        </Crumb>
        <OrgCrumb orgId={orgId} current={!trail} />
        {trail}
      </ol>
    </nav>
  );
}
