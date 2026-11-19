import { Body1, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { ItemCard } from '../cards/cards';

// The chart library (d3 and friends) is large: it loads when the first chart is drawn.
/** Plot height plus room for the legend. */
const CHART_BOX_HEIGHT = 270;
const ChartBody = lazy(() => import('./ChartBody'));

const useStyles = makeStyles({
  // The chart fills its parent (height: 100%) and measures it, so the parent needs a definite height: with an
  // auto height it depends on the chart itself and the chart resizes forever ("Maximum update depth exceeded").
  chart: { width: '100%', minWidth: 0, height: `${CHART_BOX_HEIGHT}px` },
  muted: { color: tokens.colorNeutralForeground3 },
});

export interface ChartSeries {
  /** Legend text. */
  name: string;
  /** Points in time order; a null value leaves a gap. */
  points: { at: string; value: number | null }[];
  color?: string;
}

/** Palette from the Fluent tokens (they follow light/dark), in a fixed order so a series keeps its colour. */
export const SERIES_COLORS = [
  tokens.colorBrandForeground1,
  tokens.colorPaletteBerryForeground2,
  tokens.colorPaletteGreenForeground2,
  tokens.colorPaletteMarigoldForeground2,
  tokens.colorPaletteRedForeground2,
];

/** A card holding a chart; shows a muted line instead when no series has any point. */
export function ChartCard({
  title,
  subtitle,
  series,
  stacked = false,
  format,
}: {
  title: string;
  subtitle?: string;
  series: ChartSeries[];
  /** Stacked bars instead of lines (counters per step). */
  stacked?: boolean;
  /** Formats axis ticks, e.g. `v => v + ' ms'`. */
  format?: (v: number) => string;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const filled = series.map((s, i) => ({
    ...s,
    color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]!,
    points: s.points.filter((p) => p.value !== null),
  }));
  // A stacked chart whose bars are all 0 has a zero-height axis, which the chart library cannot lay out
  // (it loops re-rendering), so that case shows the empty message too.
  const any = filled.some((s) =>
    stacked ? s.points.some((p) => p.value !== 0) : s.points.length > 0,
  );

  return (
    <ItemCard title={title} subtitle={subtitle}>
      <div className={styles.chart} role="img" aria-label={title}>
        {any ? (
          <Suspense fallback={<Spinner size="tiny" />}>
            <ChartBody series={filled} title={title} stacked={stacked} format={format} />
          </Suspense>
        ) : (
          <Body1 className={styles.muted}>{t('metrics.noData')}</Body1>
        )}
      </div>
    </ItemCard>
  );
}
