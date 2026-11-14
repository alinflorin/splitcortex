import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outlet, Route, Routes } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { PoolsTab } from '../pages/organisations/PoolsTab';
import { renderWithApi, stubApi } from '../test/renderWithApi';

const auth = vi.hoisted(() => ({ user: null as null | { access_token: string } }));
vi.mock('react-oidc-context', () => ({ useAuth: () => ({ user: auth.user }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  auth.user = null;
});

const org = {
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
};

describe('api hooks', () => {
  it('do not call the API before the user is signed in (a tokenless 401 would stick)', async () => {
    const calls = stubApi({});
    await renderWithApi(
      <Sidebar open overlay={false} onOpenChange={vi.fn()} />,
      '/organisations/o1/pools',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });

  it('show the admin-only Settings item on a direct load once the token exists', async () => {
    auth.user = { access_token: 'tok' };
    stubApi({ 'GET /api/organisations/o1': org });
    await renderWithApi(
      <Sidebar open overlay={false} onOpenChange={vi.fn()} />,
      '/organisations/o1/pools',
    );
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keep the New pool action visible when an organisation has no pools', async () => {
    auth.user = { access_token: 'tok' };
    stubApi({ 'GET /api/organisations/o1/pools': [] });
    await renderWithApi(
      <Routes>
        <Route element={<Outlet context={org} />}>
          <Route path="/" element={<PoolsTab />} />
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('No pools yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New pool' })).toBeInTheDocument();
  });
});
