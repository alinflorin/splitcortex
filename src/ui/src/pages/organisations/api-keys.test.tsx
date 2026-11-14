import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiKeyRequest, apiKeyState } from '../../api/schemas';
import type { ApiKey, Organisation } from '../../api/schemas';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { ApiKeysPage } from './ApiKeysPage';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'tok', profile: { sub: 's' } } }),
}));
afterEach(() => vi.unstubAllGlobals());

const org = (role: Organisation['role']): Organisation => ({
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
});
const renderPage = (role: Organisation['role']) =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={org(role)} />}>
        <Route path="/" element={<ApiKeysPage />} />
      </Route>
    </Routes>,
  );

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
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
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const pools = [
  {
    id: 'p1',
    orgId: 'o1',
    name: 'Alpha',
    requireApproval: false,
    servingType: 'replicated',
    balancingType: 'weighted_p2c',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('api keys', () => {
  it('creates a pool-scoped key and shows the secret once', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/api-keys': [],
      'GET /api/organisations/o1/pools': pools,
      'POST /api/organisations/o1/api-keys': {
        key: key({ allPools: false, poolIds: ['p1'] }),
        secret: 'sc_secret-value',
      },
    });
    const user = userEvent.setup();
    await renderPage('owner');
    await user.click(await screen.findByRole('button', { name: 'New API key' }));
    await user.type(await screen.findByLabelText(/Name/), 'Prod');
    await user.click(screen.getByRole('radio', { name: 'Selected pools' }));
    // a pool must be picked
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Pick at least one pool.')).toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByDisplayValue('sc_secret-value')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/organisations/o1/api-keys')?.body).toEqual({
      name: 'Prod',
      scope: 'pools',
      poolIds: ['p1'],
    });
  });

  it('shows nothing to fetch for plain members', async () => {
    const calls = stubApi({ 'GET /api/organisations/o1/pools': pools });
    await renderPage('member');
    expect(await screen.findByText(/managed by organisation admins/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('api-keys'))).toBe(false);
  });
});

describe('api key helpers', () => {
  it('turns the form into a request with an absolute expiry', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(apiKeyRequest({ name: 'x', scope: 'org', poolIds: ['p'], expiry: '30' }, now)).toEqual({
      name: 'x',
      scope: 'org',
      poolIds: [],
      expiresAt: '2026-01-31T00:00:00.000Z',
    });
  });
  it('derives the state', () => {
    const now = Date.UTC(2026, 5, 1);
    expect(apiKeyState(key(), now)).toBe('active');
    expect(apiKeyState(key({ expiresAt: '2026-01-01T00:00:00.000Z' }), now)).toBe('expired');
    expect(apiKeyState(key({ revokedAt: '2026-01-01T00:00:00.000Z' }), now)).toBe('revoked');
  });
});
