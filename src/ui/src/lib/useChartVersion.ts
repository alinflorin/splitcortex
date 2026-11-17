import { useEffect, useState } from 'react';

/** The Helm chart version this app was deployed with (`/version.json`, written by the chart); null until known. */
export function useChartVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null))
      .then((j) => {
        if (!cancelled && j?.version) setVersion(j.version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
