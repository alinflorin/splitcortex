import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAnalyticsId } from './config';
import { useConsent } from './consent';
import { applyConsent, trackPageView } from './gtag';

/** Sends page views to Google Analytics: only where an id is configured (production) and only after consent. */
export function Analytics() {
  const id = useAnalyticsId();
  const { consent } = useConsent();
  const { pathname } = useLocation();

  useEffect(() => {
    if (id) applyConsent(id, consent);
  }, [id, consent]);

  useEffect(() => {
    if (id && consent === 'granted') trackPageView(pathname);
  }, [id, consent, pathname]);

  return null;
}
