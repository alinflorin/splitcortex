import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Organisation } from '../../api/schemas';
import { NO_LIMITS } from '../../api/schemas';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { saveFile } from '../../lib/saveFile';
import { AuditPage } from './AuditPage';

vi.mock('../../lib/saveFile', () => ({ saveFile: vi.fn() }));

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
  role: 'admin',
};
const renderIn = (role: Organisation['role']) =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={{ ...org, role }} />}>
        <Route path="/" element={<AuditPage />} />
        <Route path="/organisations/o1" element={<p>org home</p>} />
      </Route>
    </Routes>,
  );

describe('audit log page', () => {
  it('lists entries as cards for admins', async () => {
    stubApi({
      'GET /api/organisations/o1/audit-logs?limit=30': {
        items: [
          {
            id: 'a1',
            occurredAt: '2026-05-01T10:00:00.000Z',
            source: 'control_plane',
            actorType: 'user',
            actorId: 'own@x.io',
            action: 'pool.update',
            entityType: 'pool',
            entityId: 'p1',
            outcome: 'success',
            ip: null,
            metadata: { changes: { name: 'p2' } },
          },
          {
            id: 'a2',
            occurredAt: '2026-05-01T09:00:00.000Z',
            source: 'gateway',
            actorType: 'node',
            actorId: 'n1',
            action: 'node.connect_rejected',
            entityType: 'node',
            entityId: 'n1',
            outcome: 'denied',
            ip: null,
            metadata: { reason: 'bad_signature' },
          },
        ],
        nextCursor: null,
      },
    });
    await renderIn('admin');
    expect(await screen.findByText('Pool updated')).toBeInTheDocument();
    expect(screen.getByText('Node connection refused')).toBeInTheDocument();
    expect(screen.getByText(/own@x.io/)).toBeInTheDocument();
    expect(screen.getByText(/reason: bad_signature/)).toBeInTheDocument();
    expect(screen.getByText('Denied')).toBeInTheDocument();
  });

  it('downloads the filtered log as CSV', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/audit-logs?limit=30': { items: [], nextCursor: null },
      'GET /api/organisations/o1/audit-logs/export?format=csv': 'occurredAt,source',
    });
    await renderIn('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(vi.mocked(saveFile).mock.calls[0]![1]).toMatch(/^audit-log-\d{4}-\d\d-\d\d\.csv$/);
    expect(calls.some((c) => c.key.includes('/audit-logs/export?format=csv'))).toBe(true);
  });

  it('sends plain members away without calling the API', async () => {
    const calls = stubApi({});
    await renderIn('member');
    expect(await screen.findByText('org home')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
