import { useState } from 'react';
import { Dropdown, Field, Option, Switch, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { useMetrics } from '../../api/hooks';
import type { Metrics } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList } from '../../components/cards/cards';
import { ChartCard } from '../../components/charts/TimeCharts';
import type { ChartSeries } from '../../components/charts/TimeCharts';

const MIN = 60_000;
const RANGES = {
  '15m': 15 * MIN,
  '1h': 60 * MIN,
  '6h': 6 * 60 * MIN,
  '24h': 24 * 60 * MIN,
  '7d': 7 * 24 * 60 * MIN,
} as const;
type Range = keyof typeof RANGES;

const useStyles = makeStyles({
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXL,
    '@media (max-width: 599px)': { flexDirection: 'column', alignItems: 'stretch' },
  },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
});

type Pick<T> = (p: T) => number | null;
const line = <T extends { bucket: string }>(
  name: string,
  rows: T[],
  pick: Pick<T>,
): ChartSeries => ({ name, points: rows.map((r) => ({ at: r.bucket, value: pick(r) })) });

/**
 * Live charts (refreshed every 15 s, switch off to freeze) of an organisation, narrowed to one pool or one node.
 * A node shows only its own telemetry; the gateway numbers (requests, latency, limits) exist per pool.
 */
export function MetricsView({
  orgId,
  poolId,
  nodeId,
}: {
  orgId: string;
  poolId?: string;
  nodeId?: string;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>('1h');
  const [live, setLive] = useState(true);
  const query = useMetrics(orgId, { windowMs: RANGES[range], poolId, nodeId }, live);
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const ms = (v: number) => `${number.format(v)} ms`;
  const pct = (v: number) => `${number.format(v)}%`;

  return (
    <>
      <div className={styles.filters}>
        <Field label={t('metrics.range')}>
          <Dropdown
            value={t(`metrics.ranges.${range}`)}
            selectedOptions={[range]}
            onOptionSelect={(_, d) => setRange(d.optionValue as Range)}
          >
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Option key={r} value={r}>
                {t(`metrics.ranges.${r}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Switch checked={live} onChange={(_, d) => setLive(d.checked)} label={t('metrics.live')} />
      </div>
      <QueryBoundary query={query}>
        {(m: Metrics) => (
          <div className={styles.section}>
            {!nodeId && (
              <CardList variant="grid">
                <ChartCard
                  title={t('metrics.requests')}
                  stacked
                  series={[
                    line(t('metrics.requests'), m.pools, (p) => p.requests - p.errors),
                    line(t('metrics.errors'), m.pools, (p) => p.errors),
                  ]}
                />
                <ChartCard
                  title={t('metrics.tokens')}
                  stacked
                  series={[
                    line(t('usage.tokensIn'), m.pools, (p) => p.tokensIn),
                    line(t('usage.tokensOut'), m.pools, (p) => p.tokensOut),
                  ]}
                />
                <ChartCard
                  title={t('metrics.latency')}
                  subtitle={t('metrics.latencyHint')}
                  format={ms}
                  series={[
                    line('p50', m.pools, (p) => p.latencyP50Ms),
                    line('p95', m.pools, (p) => p.latencyP95Ms),
                  ]}
                />
                <ChartCard
                  title={t('metrics.ttft')}
                  subtitle={t('metrics.latencyHint')}
                  format={ms}
                  series={[
                    line('p50', m.pools, (p) => p.ttftP50Ms),
                    line('p95', m.pools, (p) => p.ttftP95Ms),
                  ]}
                />
                <ChartCard
                  title={t('metrics.refused')}
                  stacked
                  series={[
                    line(t('metrics.rateLimited'), m.pools, (p) => p.rateLimited),
                    line(t('metrics.unavailable'), m.pools, (p) => p.unavailable),
                  ]}
                />
                <ChartCard
                  title={t('metrics.peakInFlight')}
                  series={[line(t('metrics.peakInFlight'), m.pools, (p) => p.peakInFlight)]}
                />
              </CardList>
            )}
            <CardList variant="grid">
              <ChartCard
                title={t('metrics.tokensPerSec')}
                series={[line(t('metrics.tokensPerSec'), m.nodes, (n) => n.tokensPerSec)]}
              />
              <ChartCard
                title={t('metrics.cpu')}
                format={pct}
                series={[line(t('metrics.cpu'), m.nodes, (n) => n.cpuPercent)]}
              />
              <ChartCard
                title={t('metrics.memory')}
                format={(v) => `${number.format(v)} MB`}
                series={[line(t('metrics.memory'), m.nodes, (n) => n.memoryUsedMb)]}
              />
              <ChartCard
                title={t('metrics.battery')}
                subtitle={nodeId ? undefined : t('metrics.lowest')}
                format={pct}
                series={[line(t('metrics.battery'), m.nodes, (n) => n.batteryPercent)]}
              />
              <ChartCard
                title={t('metrics.temperature')}
                subtitle={nodeId ? undefined : t('metrics.highest')}
                format={(v) => `${number.format(v)} °C`}
                series={[line(t('metrics.temperature'), m.nodes, (n) => n.temperatureC)]}
              />
              <ChartCard
                title={t('metrics.nodeInFlight')}
                series={[line(t('metrics.nodeInFlight'), m.nodes, (n) => n.inFlight)]}
              />
              {!nodeId && (
                <ChartCard
                  title={t('metrics.nodesReporting')}
                  series={[line(t('metrics.nodesReporting'), m.nodes, (n) => n.nodesReporting)]}
                />
              )}
            </CardList>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
