import {
  Button,
  ProgressBar,
  Subtitle1,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkCircle20Regular, Delete20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDeleteNode, useNode, useUpdateNode } from '../../api/hooks';
import type { Node } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard, Stat, StatRow } from '../../components/cards/cards';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { NodeStatusBadge } from '../../components/status/StatusBadge';
import { formatAgo, formatBytes } from '../../lib/format';
import { isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXL },
  back: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalM,
  },
  title: { flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  meter: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, width: '100%' },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** A metric with an optional bar, e.g. "CPU 42%". */
function Meter({ label, value, percent }: { label: string; value: string; percent?: number }) {
  const styles = useStyles();
  return (
    <div className={styles.meter}>
      <Stat label={label} value={value} />
      {percent !== undefined && (
        <ProgressBar
          value={Math.min(100, Math.max(0, percent)) / 100}
          thickness="large"
          aria-label={label}
          color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'brand'}
        />
      )}
    </div>
  );
}

export function NodePage() {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const org = useOrganisationContext();
  const { nodeId = '' } = useParams();
  const admin = isAdmin(org.role);
  const query = useNode(org.id, nodeId);
  const update = useUpdateNode(org.id, nodeId);
  const remove = useDeleteNode(org.id, nodeId);
  const confirm = useConfirm();
  const toast = useToast();
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const dash = '—';

  const approve = () =>
    update.mutate({ approved: true }, { onSuccess: () => toast.success(t('nodes.approved')) });

  const revoke = async (node: Node) => {
    const ok = await confirm({
      title: t('nodes.revokeTitle', { name: node.name }),
      message: t('nodes.revokeMessage'),
      confirmLabel: t('nodes.revoke'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success(t('nodes.revoked'));
      void navigate(`/organisations/${org.id}/pools/${node.poolId}`);
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <div className={styles.root}>
      <QueryBoundary query={query}>
        {(node) => {
          const live = node.live;
          const memPercent =
            live?.memoryUsedMb != null && node.memoryTotalMb
              ? (live.memoryUsedMb / node.memoryTotalMb) * 100
              : undefined;
          return (
            <>
              <Link to={`/organisations/${org.id}/pools/${node.poolId}`} className={styles.back}>
                ← {t('nodes.backToPool')}
              </Link>
              <div className={styles.header}>
                <Title2 className={styles.title}>{node.name}</Title2>
                <NodeStatusBadge status={node.status} />
                {admin && (
                  <div className={styles.actions}>
                    {!node.approved && (
                      <Button
                        appearance="primary"
                        icon={<CheckmarkCircle20Regular />}
                        disabled={update.isPending}
                        onClick={approve}
                      >
                        {t('nodes.approve')}
                      </Button>
                    )}
                    <Button icon={<Delete20Regular />} onClick={() => void revoke(node)}>
                      {t('nodes.revoke')}
                    </Button>
                  </div>
                )}
              </div>

              <section className={styles.section}>
                <Subtitle1>{t('nodes.live')}</Subtitle1>
                {live ? (
                  <CardList variant="grid">
                    <ItemCard title={t('nodes.cpu')}>
                      <Meter
                        label={t('nodes.cpuUsage')}
                        value={live.cpuPercent == null ? dash : `${num.format(live.cpuPercent)}%`}
                        percent={live.cpuPercent ?? undefined}
                      />
                    </ItemCard>
                    <ItemCard title={t('nodes.memory')}>
                      <Meter
                        label={t('nodes.memoryUsage')}
                        value={
                          live.memoryUsedMb == null
                            ? dash
                            : `${formatBytes(live.memoryUsedMb * 1024 ** 2, i18n.language)}${
                                node.memoryTotalMb
                                  ? ` / ${formatBytes(node.memoryTotalMb * 1024 ** 2, i18n.language)}`
                                  : ''
                              }`
                        }
                        percent={memPercent}
                      />
                    </ItemCard>
                    <ItemCard title={t('nodes.load')}>
                      <StatRow>
                        <Stat label={t('nodes.inFlight')} value={live.inFlight} />
                        <Stat
                          label={t('nodes.tokensPerSec')}
                          value={live.tokensPerSec == null ? dash : num.format(live.tokensPerSec)}
                        />
                      </StatRow>
                    </ItemCard>
                    <ItemCard title={t('nodes.power')}>
                      <StatRow>
                        <Stat
                          label={t('nodes.battery')}
                          value={
                            live.batteryPercent == null
                              ? dash
                              : `${live.batteryPercent}%${live.charging ? ` · ${t('nodes.charging')}` : ''}`
                          }
                        />
                        <Stat
                          label={t('nodes.temperature')}
                          value={
                            live.temperatureC == null ? dash : `${num.format(live.temperatureC)} °C`
                          }
                        />
                      </StatRow>
                    </ItemCard>
                    <ItemCard title={t('nodes.connection')}>
                      <StatRow>
                        <Stat
                          label={t('nodes.connectedSince')}
                          value={
                            live.connectedSince
                              ? formatAgo(live.connectedSince, i18n.language)
                              : dash
                          }
                        />
                        <Stat
                          label={t('nodes.lastReport')}
                          value={formatAgo(live.updatedAt, i18n.language)}
                        />
                      </StatRow>
                    </ItemCard>
                  </CardList>
                ) : (
                  <CardList>
                    <ItemCard
                      title={t(
                        node.status === 'pending' ? 'nodes.pendingTitle' : 'nodes.offlineTitle',
                      )}
                      subtitle={t(
                        node.status === 'pending' ? 'nodes.pendingHint' : 'nodes.offlineHint',
                      )}
                    />
                  </CardList>
                )}
              </section>

              <section className={styles.section}>
                <Subtitle1>{t('nodes.device')}</Subtitle1>
                <ItemCard title={node.deviceModel ?? t('nodes.unknownDevice')}>
                  <StatRow>
                    <Stat label={t('nodes.platform')} value={node.platform ?? dash} />
                    <Stat label={t('nodes.os')} value={node.osVersion ?? dash} />
                    <Stat label={t('nodes.app')} value={node.appVersion ?? dash} />
                    <Stat label={t('nodes.cores')} value={node.cpuCores ?? dash} />
                    <Stat
                      label={t('nodes.memoryTotal')}
                      value={
                        node.memoryTotalMb
                          ? formatBytes(node.memoryTotalMb * 1024 ** 2, i18n.language)
                          : dash
                      }
                    />
                    <Stat label={t('nodes.fingerprint')} value={node.fingerprint} />
                    <Stat
                      label={t('common.created')}
                      value={new Date(node.createdAt).toLocaleString()}
                    />
                  </StatRow>
                </ItemCard>
              </section>
            </>
          );
        }}
      </QueryBoundary>
    </div>
  );
}
