import { screen } from '@testing-library/react';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Organisation } from '../../api/schemas';
import { NO_LIMITS } from '../../api/schemas';
import { renderWithApi } from '../../test/renderWithApi';
import { MetricsTab } from './MetricsTab';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'tok', profile: { sub: 's' } } }),
}));
// jsdom has no canvas/layout: the charts themselves are the library's business.
vi.mock('@fluentui/react-charts', () => ({
  LineChart: ({ data }: { data: { lineChartData: { legend: string }[] } }) => (
    <div data-testid="line">{data.lineChartData.map((s) => s.legend).join(',')}</div>
  ),
  VerticalStackedBarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bars">{data.length}</div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());

const org: Organisation = {
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  limits: NO_LIMITS,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'member',
};
const empty = { from: '', to: '', step: '1m', pools: [], nodes: [] };
const point = {
  bucket: '2026-05-01T10:00:00.000Z',
  requests: 10,
  errors: 1,
  tokensIn: 5,
  tokensOut: 7,
  rateLimited: 2,
  unavailable: 0,
  peakInFlight: 3,
  latencyP50Ms: 250,
  latencyP95Ms: 1000,
  ttftP50Ms: 100,
  ttftP95Ms: 500,
};
const node = {
  bucket: point.bucket,
  nodesReporting: 2,
  cpuPercent: 40,
  memoryUsedMb: 900,
  batteryPercent: 70,
  temperatureC: 31,
  inFlight: 1.5,
  tokensPerSec: 22,
  requests: 10,
  failures: 2,
  measuredTokensPerSec: 18.5,
};

function stubMetrics(body: unknown) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url === '/version.json') return new Response(JSON.stringify({ version: '1.2.3' }));
      return new Response(JSON.stringify(url.includes('/metrics?') ? body : {}), { status: 200 });
    }),
  );
  return urls;
}
const renderTab = () =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={org} />}>
        <Route path="/" element={<MetricsTab />} />
      </Route>
    </Routes>,
  );

describe('metrics page', () => {
  it('draws gateway and device charts for the organisation', async () => {
    const urls = stubMetrics({ ...empty, pools: [point], nodes: [node] });
    renderTab();
    expect((await screen.findAllByText('Request duration')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Devices reporting').length).toBeGreaterThan(0);
    // what the gateway measured next to what devices report
    expect(screen.getAllByText('Tokens per second (measured)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failure rate').length).toBeGreaterThan(0);
    expect((await screen.findAllByTestId('line')).length).toBeGreaterThan(3);
    expect(await screen.findAllByTestId('bars')).not.toHaveLength(0);
    expect(urls.find((u) => u.includes('/metrics?'))).toMatch(
      /^\/api\/organisations\/o1\/metrics\?from=/,
    );
  });

  it('says so when a period has no data', async () => {
    stubMetrics(empty);
    renderTab();
    expect((await screen.findAllByText('No data in this period.')).length).toBeGreaterThan(3);
  });
});
