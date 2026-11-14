import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { Sidebar } from './Sidebar';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'tok', profile: { sub: 's' } } }),
}));

afterEach(() => vi.unstubAllGlobals());

const org = (id: string, role: string) => ({
  id,
  name: `Org ${id}`,
  slug: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
});
const sidebar = () => <Sidebar open overlay={false} onOpenChange={vi.fn()} />;

describe('organisation sidebar section', () => {
  it('shows the organisation pages, with Settings for admins only', async () => {
    stubApi({
      'GET /api/organisations': [org('o1', 'admin'), org('o2', 'member')],
      'GET /api/organisations/o1': org('o1', 'admin'),
    });
    await renderWithApi(sidebar(), '/organisations/o1/members');
    expect(await screen.findByRole('link', { name: 'Pools' })).toHaveAttribute(
      'href',
      '/organisations/o1/pools',
    );
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Usage' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/organisations/o1/settings',
    );
    // only the organisation is shown: no top-level items, but a way back
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All organisations' })).toHaveAttribute(
      'href',
      '/organisations',
    );
  });

  it('hides organisation Settings from plain members', async () => {
    stubApi({
      'GET /api/organisations': [org('o1', 'member')],
      'GET /api/organisations/o1': org('o1', 'member'),
    });
    await renderWithApi(sidebar(), '/organisations/o1/pools/p1');
    expect(await screen.findByRole('link', { name: 'Pools' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('has no organisation section outside an organisation', async () => {
    stubApi({});
    await renderWithApi(sidebar(), '/about');
    expect(screen.queryByRole('link', { name: 'Pools' })).not.toBeInTheDocument();
  });
});
