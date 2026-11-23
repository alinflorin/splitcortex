import { useEffect } from 'react';
import { useAnalyticsId } from './config';
import { useConsent } from './consent';
import { applyConsent, trackPageView } from './gtag';

/** Sends the page view to Google Analytics: only where an id is configured (production) and only after consent. */
export function Analytics() {
  const id = useAnalyticsId();
  const { consent } = useConsent();

  useEffect(() => {
    if (id) applyConsent(id, consent);
  }, [id, consent]);

  // one screen, no routes: the path is always `/` (the enrollment code in the fragment is never sent)
  useEffect(() => {
    if (id && consent === 'granted') trackPageView(window.location.pathname);
  }, [id, consent]);

  return null;
}
