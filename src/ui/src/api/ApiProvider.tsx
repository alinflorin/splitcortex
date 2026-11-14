import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/feedback/useToast';
import { ApiError } from './client';

/** Query client for the control plane API. Failed mutations surface as an error toast. */
export function ApiProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { t } = useTranslation();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Do not retry client errors (403/404/409...); they will not change.
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          onError: (err) =>
            toast.error(t('errors.generic'), {
              body: err instanceof ApiError ? err.message : undefined,
            }),
        }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
