import { LineChart, VerticalStackedBarChart } from '@fluentui/react-charts';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartSeries } from './TimeCharts';

const HEIGHT = 220;
// Module-level so the chart sees the same object on every render (an inline one re-triggers its effects).
const LEGEND_PROPS = { canSelectMultipleLegends: true };

/** The chart itself; kept in its own module so the chart library loads on demand (see `TimeCharts`). */
export default function ChartBody({
  series,
  title,
  stacked,
  format,
}: {
  series: (ChartSeries & { color: string })[];
  title: string;
  stacked: boolean;
  format?: (v: number) => string;
}) {
  const { i18n } = useTranslation();
  // The parent rebuilds `series` on every render (live refresh included). The chart library resets its state when
  // `data` changes identity, which loops, so hand it new data only when the numbers really change.
  const signature = JSON.stringify([series, stacked]);
  const stable = useMemo(() => series, [signature]);
  const formatRef = useRef(format);
  formatRef.current = format;
  const hasFormat = !!format;
  const tick = useCallback(
    (v: number | string) => (formatRef.current ? formatRef.current(Number(v)) : String(v)),
    [],
  );

  const lineData = useMemo(
    () => ({
      chartTitle: title,
      lineChartData: stable.map((s) => ({
        legend: s.name,
        color: s.color,
        // The library renders a one-point series through a code path that emits an unkeyed list (React key
        // warning), so repeat the point: same position, same look.
        data: (s.points.length === 1 ? [s.points[0]!, s.points[0]!] : s.points).map((p) => ({
          x: new Date(p.at),
          y: p.value as number,
        })),
      })),
    }),
    [stable, title],
  );
  const barData = useMemo(() => {
    const at = [...new Set(stable.flatMap((s) => s.points.map((p) => p.at)))].sort();
    return at.map((x) => ({
      xAxisPoint: new Date(x),
      chartData: stable.map((s) => ({
        legend: s.name,
        color: s.color,
        data: s.points.find((p) => p.at === x)?.value ?? 0,
      })),
    }));
  }, [stable]);

  if (!stacked) {
    return (
      <LineChart
        data={lineData}
        height={HEIGHT}
        culture={i18n.language}
        yAxisTickFormat={hasFormat ? tick : undefined}
        hideLegend={stable.length < 2}
        legendProps={LEGEND_PROPS}
      />
    );
  }
  return (
    <VerticalStackedBarChart
      data={barData}
      height={HEIGHT}
      culture={i18n.language}
      barWidth="auto"
      yAxisTickFormat={hasFormat ? tick : undefined}
      hideLegend={stable.length < 2}
    />
  );
}
