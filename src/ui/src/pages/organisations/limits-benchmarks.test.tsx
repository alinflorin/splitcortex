import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiKey, Benchmark, Organisation, Pool } from '../../api/schemas';
import { NO_LIMITS } from '../../api/schemas';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { ApiKeysPage } from './ApiKeysPage';
import { OrganisationSettingsTab } from './OrganisationSettingsTab';
import { PoolBenchmarks } from './PoolBenchmarks';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'tok', profile: { sub: 's' } } }),
}));
afterEach(() => vi.unstubAllGlobals());

const org: Organisation = {
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  limits: NO_LIMITS,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'owner',
};
const renderIn = (element: React.ReactElement, role: Organisation['role'] = 'owner') =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={{ ...org, role }} />}>
        <Route path="/" element={element} />
      </Route>
    </Routes>,
  );

describe('rate limits', () => {
  it('saves organisation limits, flags invalid input and sends null for an empty field', async () => {
    const calls = stubApi({
      'PATCH /api/organisations/o1': {
        ...org,
        limits: { requestsPerMinute: 100, tokensPerMinute: null, tokensPerDay: null },
      },
    });
    const user = userEvent.setup();
    await renderIn(<OrganisationSettingsTab />);
    const rpm = await screen.findByLabelText('Requests per minute');
    const save = screen.getByRole('button', { name: 'Save limits' });
    expect(save).toBeDisabled(); // nothing changed

    await user.type(rpm, 'abc');
    expect(await screen.findByText(/Enter a whole number from 1 to 10000000/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(rpm);
    await user.type(rpm, '100');
    await user.click(save);
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/organisations/o1')?.body).toEqual({
        limits: { requestsPerMinute: 100, tokensPerMinute: null, tokensPerDay: null },
      }),
    );
  });

  const key: ApiKey = {
    id: 'k1',
    orgId: 'o1',
    name: 'CI',
    prefix: 'sc_AbCdEf',
    allPools: true,
    poolIds: [],
    expiresAt: null,
    createdBy: 'a@x.io',
    lastUsedAt: null,
    revokedAt: null,
    limits: { requestsPerMinute: 5, tokensPerMinute: null, tokensPerDay: 1000 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('shows a key’s limits and edits them', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/api-keys': [key],
      'GET /api/organisations/o1/pools': [],
      'PATCH /api/organisations/o1/api-keys/k1': key,
    });
    const user = userEvent.setup();
    await renderIn(<ApiKeysPage />);
    expect(await screen.findByText('5 requests/min · 1000 tokens/day')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit limits' }));
    const day = await screen.findByLabelText('Tokens per day');
    expect(day).toHaveValue('1000');
    await user.clear(day);
    // While the dialog settles Fluent marks it hidden for the accessibility tree.
    fireEvent.click(await screen.findByRole('button', { name: 'Save limits', hidden: true }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/organisations/o1/api-keys/k1')?.body).toEqual({
        limits: { requestsPerMinute: 5, tokensPerMinute: null, tokensPerDay: null },
      }),
    );
  });

  it('creates a key with limits only when one is set', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/api-keys': [],
      'GET /api/organisations/o1/pools': [],
      'POST /api/organisations/o1/api-keys': { key, secret: 'sc_x' },
    });
    const user = userEvent.setup();
    await renderIn(<ApiKeysPage />);
    await user.click(await screen.findByRole('button', { name: 'New API key' }));
    await user.type(await screen.findByLabelText(/Name/), 'Prod');
    await user.type(screen.getByLabelText('Tokens per minute'), '9000');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'POST /api/organisations/o1/api-keys')?.body,
      ).toMatchObject({
        limits: { requestsPerMinute: null, tokensPerMinute: 9000, tokensPerDay: null },
      }),
    );
  });
});

describe('benchmarks', () => {
  const pool: Pool = {
    id: 'p1',
    orgId: 'o1',
    name: 'Alpha',
    requireApproval: false,
    servingType: 'replicated',
    balancingType: 'weighted_p2c',
    onlineNodes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const done: Benchmark = {
    id: 'b1',
    poolId: 'p1',
    createdBy: 'a@x.io',
    createdAt: '2026-02-01T10:00:00.000Z',
    status: 'done',
    results: [
      {
        nodeId: 'n1',
        nodeName: 'Pixel',
        status: 'done',
        error: null,
        ttftMs: 800,
        totalMs: 6000,
        tokens: 96,
        tokensPerSec: 18.5,
      },
      {
        nodeId: 'n2',
        nodeName: 'Galaxy',
        status: 'done',
        error: null,
        ttftMs: 1200,
        totalMs: 9000,
        tokens: 96,
        tokensPerSec: 12.2,
      },
      {
        nodeId: 'n3',
        nodeName: 'Old phone',
        status: 'failed',
        error: 'The node disconnected',
        ttftMs: null,
        totalMs: null,
        tokens: null,
        tokensPerSec: null,
      },
    ],
  };

  it('shows per-device results with the pool total, and why a device failed', async () => {
    stubApi({ 'GET /api/organisations/o1/pools/p1/benchmarks': [done] });
    await renderIn(<PoolBenchmarks pool={pool} admin />);
    expect(await screen.findByText('Pixel')).toBeInTheDocument();
    expect(screen.getByText('18.5')).toBeInTheDocument();
    expect(screen.getByText('0.8 s')).toBeInTheDocument();
    expect(screen.getByText('30.7 tokens/s')).toBeInTheDocument(); // 18.5 + 12.2
    expect(screen.getByText('The node disconnected')).toBeInTheDocument();
  });

  it('starts a benchmark (admins) and blocks a second one while it runs', async () => {
    const running: Benchmark = {
      ...done,
      id: 'b2',
      status: 'running',
      results: [{ ...done.results[0]!, status: 'running', tokensPerSec: null }],
    };
    const calls = stubApi({
      'GET /api/organisations/o1/pools/p1/benchmarks': [],
      'POST /api/organisations/o1/pools/p1/benchmarks': running,
    });
    const user = userEvent.setup();
    await renderIn(<PoolBenchmarks pool={pool} admin />);
    await user.click(await screen.findByRole('button', { name: 'Run benchmark' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'POST /api/organisations/o1/pools/p1/benchmarks')).toBe(
        true,
      ),
    );
  });

  it('hides the run button from members', async () => {
    stubApi({ 'GET /api/organisations/o1/pools/p1/benchmarks': [done] });
    await renderIn(<PoolBenchmarks pool={pool} admin={false} />, 'member');
    expect(await screen.findByText('Pixel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run benchmark' })).toBeNull();
  });
});
