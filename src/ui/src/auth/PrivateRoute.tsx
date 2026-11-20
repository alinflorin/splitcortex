import { useEffect, useRef, useState } from 'react';
import { Button, MessageBar, MessageBarBody, Spinner } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { endSignOut, isSigningOut } from './signOut';

/** Layout route: renders children only for signed-in users, otherwise sends the user to Dex. */
export function PrivateRoute() {
  const auth = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  const redirecting = useRef(false);
  const [renewFailed, setRenewFailed] = useState(false);

  const { isLoading, isAuthenticated, activeNavigator, error, signinRedirect, signinSilent, user } =
    auth;
  const hasRefreshToken = !!user?.refresh_token;
  const returnTo = location.pathname + location.search;

  // Leaving this page ends a sign-out that started on it.
  useEffect(() => endSignOut, []);

  useEffect(() => {
    if (isSigningOut(location.pathname)) return;
    if (isLoading || isAuthenticated || activeNavigator || error || redirecting.current) return;
    redirecting.current = true;
    const toDex = () => {
      setRenewFailed(true);
      void signinRedirect({ state: { returnTo } });
    };
    if (!hasRefreshToken) {
      toDex();
      return;
    }
    // The stored access token expired while no tab was open (automaticSilentRenew only runs while the page is
    // loaded): trade the refresh token for a new one first, and only send the user to Dex if that fails.
    signinSilent().then((renewed) => {
      if (!renewed) toDex();
    }, toDex);
  }, [
    isLoading,
    isAuthenticated,
    activeNavigator,
    error,
    signinRedirect,
    signinSilent,
    hasRefreshToken,
    returnTo,
    location.pathname,
  ]);

  if (isAuthenticated) return <Outlet />;

  if (error) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          {t('auth.error')}: {error.message}{' '}
          <Button
            appearance="transparent"
            size="small"
            onClick={() => {
              redirecting.current = true;
              void signinRedirect({ state: { returnTo } });
            }}
          >
            {t('auth.retry')}
          </Button>
        </MessageBarBody>
      </MessageBar>
    );
  }

  const renewing = activeNavigator === 'signinSilent' || (hasRefreshToken && !renewFailed);

  return (
    <Spinner
      labelPosition="below"
      label={t(renewing ? 'auth.renewing' : 'auth.redirecting')}
      style={{ marginTop: 96 }}
    />
  );
}
