import { useState } from 'react';
import { Body1, Dropdown, Field, Option, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { useUsage } from '../../api/hooks';
import type { UsageParams } from '../../api/hooks';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard, Stat, StatRow } from '../../components/cards/cards';

const HOUR = 3_600_000;
const RANGES = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR } as const;
type Range = keyof typeof RANGES;
type GroupBy = NonNullable<UsageParams['groupBy']> | 'none';

const useStyles = makeStyles({
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXL,
    '@media (max-width: 599px)': { flexDirection: 'column' },
  },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** Totals plus one card per period; scoped to a pool when `poolId` is given. */
export function UsageView({ orgId, poolId }: { orgId: string; poolId?: string }) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>('7d');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  // Anchored to the hour so the query key stays stable between renders.
  const [anchor] = useState(() => Math.ceil(Date.now() / HOUR) * HOUR);

  const query = useUsage(orgId, {
    from: new Date(anchor - RANGES[range]).toISOString(),
    to: new Date(anchor).toISOString(),
    granularity: range === '24h' ? 'hour' : 'day',
    groupBy: groupBy === 'none' ? undefined : groupBy,
    poolId,
  });

  const number = new Intl.NumberFormat(i18n.language);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      dateStyle: 'medium',
      ...(range === '24h' ? { timeStyle: 'short' } : {}),
    });
  // Grouping by pool is pointless inside a single pool.
  const groups = (
    poolId ? ['none', 'model', 'key'] : ['none', 'pool', 'model', 'key']
  ) as GroupBy[];

  return (
    <>
      <div className={styles.filters}>
        <Field label={t('usage.range')}>
          <Dropdown
            value={t(`usage.ranges.${range}`)}
            selectedOptions={[range]}
            onOptionSelect={(_, d) => setRange(d.optionValue as Range)}
          >
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Option key={r} value={r}>
                {t(`usage.ranges.${r}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={t('usage.groupBy')}>
          <Dropdown
            value={t(`usage.groups.${groupBy}`)}
            selectedOptions={[groupBy]}
            onOptionSelect={(_, d) => setGroupBy(d.optionValue as GroupBy)}
          >
            {groups.map((g) => (
              <Option key={g} value={g}>
                {t(`usage.groups.${g}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
      </div>

      <QueryBoundary query={query}>
        {(usage) => (
          <div className={styles.section}>
            <CardList variant="grid">
              {(['requests', 'tokensIn', 'tokensOut', 'errors'] as const).map((k) => (
                <ItemCard
                  key={k}
                  title={number.format(usage.totals[k])}
                  subtitle={t(`usage.${k}`)}
                />
              ))}
            </CardList>
            {usage.series.length === 0 ? (
              <Body1 className={styles.muted}>{t('usage.empty')}</Body1>
            ) : (
              <CardList>
                {usage.series.map((p) => (
                  <ItemCard
                    key={`${p.bucket}|${p.group ?? ''}`}
                    title={when(p.bucket)}
                    subtitle={p.group ?? undefined}
                  >
                    <StatRow>
                      <Stat label={t('usage.requests')} value={number.format(p.requests)} />
                      <Stat label={t('usage.tokensIn')} value={number.format(p.tokensIn)} />
                      <Stat label={t('usage.tokensOut')} value={number.format(p.tokensOut)} />
                      <Stat label={t('usage.errors')} value={number.format(p.errors)} />
                    </StatRow>
                  </ItemCard>
                ))}
              </CardList>
            )}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
