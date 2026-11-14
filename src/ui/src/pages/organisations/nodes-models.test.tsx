import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model, Node, Organisation } from '../../api/schemas';
import { renderWithApi, stubApi } from '../../test/renderWithApi';
import { ModelsPage } from './ModelsPage';
import { NodePage } from './NodePage';
import { PoolNodes } from './PoolSections';

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
const inOrg = (role: Organisation['role'], path: string, element: React.ReactElement) =>
  renderWithApi(
    <Routes>
      <Route element={<Outlet context={org(role)} />}>
        <Route path={path} element={element} />
      </Route>
    </Routes>,
    path.replace(':nodeId', 'n1'),
  );

const node = (over: Partial<Node> = {}): Node => ({
  id: 'n1',
  orgId: 'o1',
  poolId: 'p1',
  name: 'Pixel 8',
  fingerprint: 'AB12-CD34',
  approved: true,
  status: 'online',
  platform: 'android',
  deviceModel: 'Pixel 8',
  osVersion: '15',
  appVersion: '0.1.0',
  cpuCores: 8,
  memoryTotalMb: 8192,
  createdAt: '2026-01-01T00:00:00.000Z',
  live: {
    connectedSince: '2026-01-01T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
    cpuPercent: 42.5,
    memoryUsedMb: 4096,
    batteryPercent: 80,
    charging: true,
    temperatureC: 38.2,
    inFlight: 2,
    tokensPerSec: 21.5,
  },
  ...over,
});

describe('node view', () => {
  it('shows live cpu, memory, load and power', async () => {
    stubApi({ 'GET /api/organisations/o1/nodes/n1': node() });
    await inOrg('admin', '/nodes/:nodeId', <NodePage />);
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText(/4 GB \/ 8 GB/)).toBeInTheDocument();
    expect(screen.getByText('21.5')).toBeInTheDocument();
    expect(screen.getByText(/80% · charging/)).toBeInTheDocument();
    expect(screen.getByText('AB12-CD34')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('lets an admin approve a pending node, which has no live data', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/nodes/n1': node({
        approved: false,
        status: 'pending',
        live: null,
      }),
      'PATCH /api/organisations/o1/nodes/n1': node(),
    });
    const user = userEvent.setup();
    await inOrg('admin', '/nodes/:nodeId', <NodePage />);
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/organisations/o1/nodes/n1')?.body).toEqual({
        approved: true,
      }),
    );
  });

  it('hides actions from plain members and shows an offline explanation', async () => {
    stubApi({ 'GET /api/organisations/o1/nodes/n1': node({ status: 'offline', live: null }) });
    await inOrg('member', '/nodes/:nodeId', <NodePage />);
    expect(await screen.findByText(/no live data/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('lists a pool’s nodes as cards linking to the node view', async () => {
    stubApi({
      'GET /api/organisations/o1/pools/p1/nodes': [
        node(),
        node({ id: 'n2', name: 'Pi', live: null, status: 'offline' }),
      ],
    });
    const pool = {
      id: 'p1',
      orgId: 'o1',
      name: 'edge',
      requireApproval: false,
      servingType: 'replicated' as const,
      balancingType: 'weighted_p2c' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await renderWithApi(<PoolNodes pool={pool} />);
    expect((await screen.findAllByText(/Pixel 8/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Pi')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});

const model = (over: Partial<Model> = {}): Model => ({
  id: 'm1',
  orgId: 'o1',
  name: 'Gemma 3n',
  source: 'huggingface',
  sourceUrl: 'https://huggingface.co/a/b/resolve/main/g.litertlm',
  fileName: 'g.litertlm',
  status: 'ready',
  error: null,
  sizeBytes: 3 * 1024 ** 3,
  progressBytes: 3 * 1024 ** 3,
  sha256: 'abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('models page', () => {
  it('shows status, download progress and failures with retry', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/models': [
        model(),
        model({ id: 'm2', name: 'Big', status: 'downloading', progressBytes: 1024 ** 3 }),
        model({ id: 'm3', name: 'Broken', status: 'failed', error: 'Hugging Face denied access' }),
      ],
      'POST /api/organisations/o1/models/m3/retry': model({ id: 'm3', status: 'pending' }),
    });
    const user = userEvent.setup();
    await inOrg('admin', '/', <ModelsPage />);
    expect(await screen.findByText('Gemma 3n')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText(/1 GB \/ 3 GB/)).toBeInTheDocument();
    expect(screen.getByText('Hugging Face denied access')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry download' }));
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/m3/retry'))).toBe(true));
  });

  it('adds a model from a Hugging Face link, validating it first', async () => {
    const calls = stubApi({
      'GET /api/organisations/o1/models': [],
      'POST /api/organisations/o1/models/from-url': model({ status: 'pending' }),
    });
    const user = userEvent.setup();
    await inOrg('admin', '/', <ModelsPage />);
    await user.click(await screen.findByRole('button', { name: 'Add model' }));
    await user.type(await screen.findByLabelText(/^Name/), 'Gemma');
    const link = screen.getByLabelText(/Hugging Face link/);
    await user.type(link, 'https://evil.com/a/b/resolve/main/g.litertlm');
    await user.click(screen.getByLabelText(/^Name/)); // blur the link field
    expect(await screen.findByText(/huggingface\.co\/…/)).toBeInTheDocument();
    await user.clear(link);
    await user.type(link, 'https://huggingface.co/a/b/blob/main/g.litertlm');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'POST /api/organisations/o1/models/from-url')?.body,
      ).toEqual({
        name: 'Gemma',
        url: 'https://huggingface.co/a/b/blob/main/g.litertlm',
      }),
    );
  });

  it('hides add and delete from plain members', async () => {
    stubApi({ 'GET /api/organisations/o1/models': [model()] });
    await inOrg('member', '/', <ModelsPage />);
    await screen.findByText('Gemma 3n');
    expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
