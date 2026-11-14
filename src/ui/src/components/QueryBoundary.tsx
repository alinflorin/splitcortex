import { MessageBar, MessageBarBody, Spinner } from '@fluentui/react-components';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Renders a spinner while loading, an error bar on failure, and `children(data)` on success. */
export function QueryBoundary<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isPending) return <Spinner label={t('common.loading')} labelPosition="below" />;
  if (query.isError)
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          {t('errors.load')}: {query.error.message}
        </MessageBarBody>
      </MessageBar>
    );
  return <>{children(query.data)}</>;
}
