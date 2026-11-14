import { useState } from 'react';
import {
  Body1,
  Button,
  Dropdown,
  Option,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Add20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  useAssignModel,
  useModels,
  useNodes,
  usePoolModels,
  useUnassignModel,
} from '../../api/hooks';
import type { Pool } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard } from '../../components/cards/cards';
import { useToast } from '../../components/feedback/useToast';
import { NodeStatusBadge } from '../../components/status/StatusBadge';
import { formatAgo } from '../../lib/format';
import { ModelCard } from './ModelCard';

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  assign: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    '@media (max-width: 599px)': { flexDirection: 'column', alignItems: 'stretch' },
  },
  dropdown: { flexGrow: 1, minWidth: '220px' },
});

/** The devices of a pool as cards; each opens the node view. */
export function PoolNodes({ pool }: { pool: Pool }) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const query = useNodes(pool.orgId, pool.id);

  return (
    <QueryBoundary query={query}>
      {(nodes) =>
        nodes.length === 0 ? (
          <Body1 className={styles.muted}>{t('pools.devicesEmpty')}</Body1>
        ) : (
          <CardList>
            {nodes.map((n) => (
              <ItemCard
                key={n.id}
                title={n.name}
                subtitle={[
                  n.deviceModel,
                  n.live?.tokensPerSec != null
                    ? `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(n.live.tokensPerSec)} ${t('nodes.tokensPerSecShort')}`
                    : null,
                  n.live ? formatAgo(n.live.updatedAt, i18n.language) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={<NodeStatusBadge status={n.status} />}
                onClick={() => void navigate(`/organisations/${pool.orgId}/nodes/${n.id}`)}
              />
            ))}
          </CardList>
        )
      }
    </QueryBoundary>
  );
}

/** Models the pool serves (every node gets all of them), with a picker to add ready models. */
export function PoolModels({ pool, admin }: { pool: Pool; admin: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const served = usePoolModels(pool.orgId, pool.id);
  const all = useModels(pool.orgId);
  const assign = useAssignModel(pool.orgId, pool.id);
  const unassign = useUnassignModel(pool.orgId, pool.id);
  const [picked, setPicked] = useState<string | null>(null);

  const servedIds = new Set(served.data?.map((m) => m.id));
  const available = (all.data ?? []).filter((m) => m.status === 'ready' && !servedIds.has(m.id));
  const pickedModel = available.find((m) => m.id === picked);

  return (
    <>
      {admin && (
        <div className={styles.assign}>
          <Dropdown
            className={styles.dropdown}
            placeholder={t(available.length ? 'pools.pickModel' : 'pools.noModelsToAdd')}
            disabled={available.length === 0}
            value={pickedModel?.name ?? ''}
            selectedOptions={picked ? [picked] : []}
            onOptionSelect={(_, d) => setPicked(d.optionValue ?? null)}
          >
            {available.map((m) => (
              <Option key={m.id} value={m.id} text={m.name}>
                {m.name} <Text className={styles.muted}>{m.fileName}</Text>
              </Option>
            ))}
          </Dropdown>
          <Button
            icon={<Add20Regular />}
            disabled={!picked || assign.isPending}
            onClick={() =>
              picked &&
              assign.mutate(picked, {
                onSuccess: () => {
                  setPicked(null);
                  toast.success(t('pools.modelAdded'));
                },
              })
            }
          >
            {t('pools.addModel')}
          </Button>
        </div>
      )}
      <QueryBoundary query={served}>
        {(models) =>
          models.length === 0 ? (
            <Body1 className={styles.muted}>{t('pools.modelsEmpty')}</Body1>
          ) : (
            <CardList>
              {models.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  actions={
                    admin && (
                      <Button
                        appearance="subtle"
                        icon={<Dismiss20Regular />}
                        aria-label={t('pools.removeModel')}
                        onClick={() => unassign.mutate(m.id)}
                      />
                    )
                  }
                />
              ))}
            </CardList>
          )
        }
      </QueryBoundary>
    </>
  );
}
