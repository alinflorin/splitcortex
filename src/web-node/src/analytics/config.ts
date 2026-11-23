import { useEffect, useState } from 'react';
import { isMeasurementId } from './gtag';

let pending: Promise<string | null> | null = null;

/** The measurement id of this environment, from `/config.json` (written by the chart; empty outside production). */
function loadId(): Promise<string | null> {
  pending ??= fetch('/config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ analyticsId?: unknown }>) : null))
    .then((j) => (isMeasurementId(j?.analyticsId) ? j.analyticsId : null))
    .catch(() => null); // no config (dev server, offline): no analytics
  return pending;
}

/** The measurement id, or null when analytics is off here (everywhere but production) or not known yet. */
export function useAnalyticsId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadId().then((value) => {
      if (!cancelled) setId(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return id;
}

/** Test only. */
export function resetAnalyticsConfigForTests(): void {
  pending = null;
}
