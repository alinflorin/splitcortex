import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en, renderApp } from '../test/render';
import { PrivateRoute } from './PrivateRoute';
import { endSignOut, startSignOut } from './signOut';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));

const signinRedirect = vi.fn();
const signinSilent = vi.fn();

function mockAuth(state: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    activeNavigator: undefined,
    error: undefined,
    signinRedirect,
    signinSilent,
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
    signinSilent.mockReset();
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

  it('does not send the user to Dex while signing out from this page', async () => {
    startSignOut('/settings');
    mockAuth({});
    await renderApp(routes, '/settings');
    await new Promise((r) => setTimeout(r, 50));
    expect(signinRedirect).not.toHaveBeenCalled();
    endSignOut();
  });

  it('renews an expired session with the refresh token instead of going to Dex', async () => {
    signinSilent.mockResolvedValue({ access_token: 'new' });
    mockAuth({ user: { refresh_token: 'r', expired: true } });
    await renderApp(routes, '/settings');
    await waitFor(() => expect(signinSilent).toHaveBeenCalledTimes(1));
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('falls back to Dex when the refresh is rejected', async () => {
    signinSilent.mockRejectedValue({ error: 'invalid_grant' });
    mockAuth({ user: { refresh_token: 'r', expired: true } });
    await renderApp(routes, '/settings');
    await waitFor(() => expect(signinRedirect).toHaveBeenCalledTimes(1));
    expect(signinSilent).toHaveBeenCalledTimes(1);
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
