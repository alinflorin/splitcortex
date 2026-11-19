import { LineChart, VerticalStackedBarChart } from '@fluentui/react-charts';
import { useTranslation } from 'react-i18next';
import type { ChartSeries } from './TimeCharts';

const HEIGHT = 220;

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
  const tick = format ? (v: number | string) => format(Number(v)) : undefined;
  if (!stacked) {
    return (
      <LineChart
        data={{
          chartTitle: title,
          lineChartData: series.map((s) => ({
            legend: s.name,
            color: s.color,
            data: s.points.map((p) => ({ x: new Date(p.at), y: p.value as number })),
          })),
        }}
        height={HEIGHT}
        culture={i18n.language}
        yAxisTickFormat={tick}
        hideLegend={series.length < 2}
        legendProps={{ canSelectMultipleLegends: true }}
      />
    );
  }
  const at = [...new Set(series.flatMap((s) => s.points.map((p) => p.at)))].sort();
  return (
    <VerticalStackedBarChart
      data={at.map((x) => ({
        xAxisPoint: new Date(x),
        chartData: series.map((s) => ({
          legend: s.name,
          color: s.color,
          data: s.points.find((p) => p.at === x)?.value ?? 0,
        })),
      }))}
      height={HEIGHT}
      culture={i18n.language}
      barWidth="auto"
      yAxisTickFormat={tick}
      hideLegend={series.length < 2}
    />
  );
}
