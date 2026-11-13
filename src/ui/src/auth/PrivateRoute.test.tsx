import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en, renderApp } from '../test/render';
import { PrivateRoute } from './PrivateRoute';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const signinRedirect = vi.fn();

function mockAuth(state: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    activeNavigator: undefined,
    error: undefined,
    signinRedirect,
    ...state,
  } as unknown as ReturnType<typeof useAuth>);
}

const routes = (
  <Routes>
    <Route element={<PrivateRoute />}>
      <Route path="/settings" element={<p>secret</p>} />
    </Route>
  </Routes>
);

describe('PrivateRoute', () => {
  beforeEach(() => {
    signinRedirect.mockReset();
    vi.mocked(useAuth).mockReset();
  });

  it('renders the child route when authenticated', async () => {
    mockAuth({ isAuthenticated: true });
    await renderApp(routes, '/settings');
    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('redirects to Dex once, remembering where the user was going', async () => {
    mockAuth({});
    await renderApp(routes, '/settings?tab=1');
    await waitFor(() => expect(signinRedirect).toHaveBeenCalledTimes(1));
    expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/settings?tab=1' } });
    expect(screen.getByText(en.auth.redirecting)).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('waits while loading', async () => {
    mockAuth({ isLoading: true });
    await renderApp(routes, '/settings');
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('shows the error and retries on demand instead of looping', async () => {
    mockAuth({ error: new Error('boom') });
    await renderApp(routes, '/settings');
    expect(signinRedirect).not.toHaveBeenCalled();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.auth.retry }));
    expect(signinRedirect).toHaveBeenCalledTimes(1);
  });
});
