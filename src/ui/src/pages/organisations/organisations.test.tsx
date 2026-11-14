import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Organisation } from '../../api/schemas';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { MembersTab } from './MembersTab';
import { OrganisationsPage } from './OrganisationsPage';
import { PoolPage } from './PoolPage';
import { PoolsTab } from './PoolsTab';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({
    user: { access_token: 'tok', profile: { sub: 's', email: 'me@x.io', name: 'Me' } },
  }),
}));

afterEach(() => vi.unstubAllGlobals());

const org = (role: Organisation['role']): Organisation => ({
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
});

/** Mounts a tab the way OrganisationLayout does: org passed through the outlet context. */
const renderTab = (tab: React.ReactElement, role: Organisation['role']) =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={org(role)} />}>
        <Route path="/" element={tab} />
      </Route>
    </Routes>,
  );

describe('organisations', () => {
  it('lists the organisations with the caller role', async () => {
    stubApi({ 'GET /api/organisations': [org('admin')] });
    await renderWithApi(<OrganisationsPage />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('creates an organisation, suggesting the slug from the name', async () => {
    const calls = stubApi({
      'GET /api/organisations': [],
      'POST /api/organisations': org('owner'),
    });
    const user = userEvent.setup();
    await renderWithApi(
      <Routes>
        <Route path="/" element={<OrganisationsPage />} />
        <Route path="/organisations/:id" element={<p>detail</p>} />
      </Routes>,
    );
    await user.click(await screen.findByRole('button', { name: 'New organisation' }));
    await user.type(await screen.findByLabelText(/Name/), 'Acme Inc');
    expect(screen.getByLabelText(/Slug/)).toHaveValue('acme-inc');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('detail')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/organisations')?.body).toEqual({
      name: 'Acme Inc',
      slug: 'acme-inc',
    });
  });
});

describe('members tab', () => {
  const members = [
    { email: 'me@x.io', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' },
    { email: 'boss@x.io', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' },
    { email: 'new@x.io', role: 'member', createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('lets an admin edit plain members only', async () => {
    stubApi({ 'GET /api/organisations/o1/members': members });
    await renderTab(<MembersTab />, 'admin');
    expect(await screen.findByText('boss@x.io')).toBeInTheDocument();
    // one editable row (the plain member); owner and admin rows are badges
    expect(screen.getAllByRole('combobox', { name: 'Role' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument();
    // remove: the plain member, plus "leave" for oneself
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Leave' })).toHaveLength(1);
  });

  it('is read-only for plain members', async () => {
    stubApi({ 'GET /api/organisations/o1/members': members });
    await renderTab(<MembersTab />, 'member');
    await screen.findByText('boss@x.io');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
  });
});

describe('pools tab', () => {
  const pools = [
    {
      id: 'p1',
      orgId: 'o1',
      name: 'edge',
      requireApproval: true,
      servingType: 'replicated',
      balancingType: 'weighted_p2c',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('confirms before deleting a pool', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/pools': pools,
      'DELETE /api/organisations/o1/pools/p1': null,
    });
    const user = userEvent.setup();
    await renderTab(<PoolsTab />, 'admin');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete pool edge?')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'DELETE /api/organisations/o1/pools/p1')).toBe(true),
    );
  });

  it('creates a pool with its serving and balancing settings', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/pools': [],
      'POST /api/organisations/o1/pools': pools[0]!,
    });
    const user = userEvent.setup();
    await renderTab(<PoolsTab />, 'admin');
    await user.click(await screen.findByRole('button', { name: 'New pool' }));
    await user.type(await screen.findByLabelText(/^Name/), 'edge');
    // defaults: replicated + weighted power of two choices
    expect(screen.getByRole('combobox', { name: /Load balancing/ })).toHaveTextContent(
      'Weighted power of two choices',
    );
    await user.click(screen.getByRole('combobox', { name: /Load balancing/ }));
    await user.click(await screen.findByRole('option', { name: 'Round robin' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/organisations/o1/pools')?.body).toEqual({
        name: 'edge',
        requireApproval: false,
        servingType: 'replicated',
        balancingType: 'round_robin',
      }),
    );
  });

  it('hides management for plain members', async () => {
    stubApi({ 'GET /api/organisations/o1/pools': pools });
    await renderTab(<PoolsTab />, 'member');
    await screen.findByText('edge');
    expect(screen.queryByRole('button', { name: 'New pool' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('pool page', () => {
  const pool = {
    id: 'p1',
    orgId: 'o1',
    name: 'edge',
    requireApproval: true,
    servingType: 'replicated',
    balancingType: 'round_robin',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const usage = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-08T00:00:00.000Z',
    granularity: 'day',
    totals: { tokensIn: 10, tokensOut: 20, requests: 3, errors: 0 },
    series: [
      {
        bucket: '2026-01-02T00:00:00.000Z',
        group: null,
        tokensIn: 10,
        tokensOut: 20,
        requests: 3,
        errors: 0,
      },
    ],
  };

  it('shows the pool, its pool-scoped usage and admin actions', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/pools/p1': pool,
      'GET /api/organisations/o1/pools/p1/nodes': [],
      'GET /api/organisations/o1/pools/p1/models': [],
      'GET /api/organisations/o1/models': [],
    });
    // the usage URL carries a changing query string; answer it for any range
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('/usage?')
        ? Promise.resolve(new Response(JSON.stringify(usage), { status: 200 }))
        : base(url, init),
    );
    await renderWithApi(
      <Routes>
        <Route element={<Outlet context={org('admin')} />}>
          <Route path="/pools/:poolId" element={<PoolPage />} />
        </Route>
      </Routes>,
      '/pools/p1',
    );
    expect((await screen.findAllByText('edge')).length).toBeGreaterThan(0);
    expect(await screen.findByText('No devices in this pool yet.')).toBeInTheDocument();
    expect((await screen.findAllByText('Requests')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /api/organisations/o1/pools/p1')).toBe(true);
  });
});
