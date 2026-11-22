import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { Breadcrumbs } from './Breadcrumbs';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'tok', profile: { sub: 's' } } }),
}));

afterEach(() => vi.unstubAllGlobals());

const org = {
  id: 'o1',
  name: 'Acme',
  slug: 'acme',
  limits: { requestsPerMinute: null, tokensPerMinute: null, tokensPerDay: null },
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'owner',
};

describe('Breadcrumbs', () => {
  it('shows nothing outside an organisation', async () => {
    stubApi({});
    await renderWithApi(<Breadcrumbs />, '/about');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('links back up the trail and marks the current page', async () => {
    stubApi({ 'GET /api/organisations/o1': org });
    await renderWithApi(<Breadcrumbs />, '/organisations/o1/members');
    expect(screen.getByRole('link', { name: 'Organisations' })).toHaveAttribute(
      'href',
      '/organisations',
    );
    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/organisations/o1',
    );
    expect(screen.getByText('Members')).toHaveAttribute('aria-current', 'page');
  });
});
