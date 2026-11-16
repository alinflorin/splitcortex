import {
  Badge,
  Body1,
  Button,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import { Delete20Regular, Play20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useBenchmarks, useDeleteBenchmark, useRunBenchmark } from '../../api/hooks';
import type { Benchmark, BenchmarkResult, Pool } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard, Stat, StatRow } from '../../components/cards/cards';
import { useToast } from '../../components/feedback/useToast';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  node: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  nodeName: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
});

const RESULT_COLOR: Record<BenchmarkResult['status'], BadgeProps['color']> = {
  pending: 'subtle',
  running: 'informative',
  done: 'success',
  failed: 'danger',
};

function Result({ r }: { r: BenchmarkResult }) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const dash = '—';
  return (
    <div className={styles.node}>
      <div>
        <Text className={styles.nodeName}>{r.nodeName ?? t('nodes.unknownDevice')}</Text>{' '}
        <Badge appearance="tint" color={RESULT_COLOR[r.status]}>
          {t(`benchmarks.status.${r.status}`)}
        </Badge>
      </div>
      {r.status === 'done' && (
        <StatRow>
          <Stat
            label={t('benchmarks.tokensPerSec')}
            value={r.tokensPerSec == null ? dash : num.format(r.tokensPerSec)}
          />
          <Stat
            label={t('benchmarks.firstToken')}
            value={r.ttftMs == null ? dash : `${num.format(r.ttftMs / 1000)} s`}
          />
          <Stat
            label={t('benchmarks.total')}
            value={r.totalMs == null ? dash : `${num.format(r.totalMs / 1000)} s`}
          />
          <Stat label={t('benchmarks.tokens')} value={r.tokens ?? dash} />
        </StatRow>
      )}
      {r.status === 'failed' && r.error && <Text className={styles.muted}>{r.error}</Text>}
    </div>
  );
}

/** Benchmarks of a pool: a fixed platform prompt run on every online node, one at a time; results fill in live. */
export function PoolBenchmarks({ pool, admin }: { pool: Pool; admin: boolean }) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const org = useOrganisationContext();
  const query = useBenchmarks(org.id, pool.id);
  const run = useRunBenchmark(org.id, pool.id);
  const remove = useDeleteBenchmark(org.id, pool.id);
  const toast = useToast();
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const running = query.data?.some((b) => b.status === 'running') ?? false;

  const total = (b: Benchmark) =>
    b.results.reduce((sum, r) => sum + (r.status === 'done' ? (r.tokensPerSec ?? 0) : 0), 0);

  return (
    <>
      <div className={styles.toolbar}>
        <Body1 className={styles.muted}>{t('benchmarks.hint')}</Body1>
        {admin && (
          <Button
            appearance="primary"
            icon={running ? <Spinner size="tiny" /> : <Play20Regular />}
            disabled={run.isPending || running}
            onClick={() =>
              run.mutate(undefined, { onSuccess: () => toast.info(t('benchmarks.started')) })
            }
          >
            {t('benchmarks.run')}
          </Button>
        )}
      </div>
      <QueryBoundary query={query}>
        {(items) =>
          items.length === 0 ? (
            <Body1 className={styles.muted}>{t('benchmarks.empty')}</Body1>
          ) : (
            <CardList>
              {items.map((b) => (
                <ItemCard
                  key={b.id}
                  title={new Date(b.createdAt).toLocaleString()}
                  subtitle={b.createdBy}
                  meta={
                    <Badge
                      appearance="tint"
                      color={b.status === 'running' ? 'informative' : 'success'}
                    >
                      {t(`benchmarks.${b.status}`)}
                    </Badge>
                  }
                  actions={
                    admin && (
                      <Button
                        appearance="subtle"
                        icon={<Delete20Regular />}
                        aria-label={t('common.delete')}
                        onClick={() => remove.mutate(b.id)}
                      />
                    )
                  }
                >
                  {b.status === 'done' &&
                    b.results.filter((r) => r.status === 'done').length > 1 && (
                      <StatRow>
                        <Stat
                          label={t('benchmarks.poolTotal')}
                          value={`${num.format(total(b))} ${t('benchmarks.unit')}`}
                        />
                      </StatRow>
                    )}
                  {b.results.map((r) => (
                    <Result key={r.nodeId} r={r} />
                  ))}
                </ItemCard>
              ))}
            </CardList>
          )
        }
      </QueryBoundary>
    </>
  );
}
