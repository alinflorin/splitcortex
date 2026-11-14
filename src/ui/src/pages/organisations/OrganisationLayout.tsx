import { MessageBar, MessageBarBody } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useOrganisation } from '../../api/hooks';
import { ApiError } from '../../api/client';
import type { Organisation } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';

export function useOrganisationContext() {
  return useOutletContext<Organisation>();
}

/** Page frame for an organisation; its name, role and navigation live in the sidebar (see OrgNav). */
export function OrganisationLayout() {
  const { t } = useTranslation();
  const { orgId = '' } = useParams();
  const query = useOrganisation(orgId);
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  if (notFound)
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          {t('organisations.notFound')} <Link to="/organisations">{t('organisations.back')}</Link>
        </MessageBarBody>
      </MessageBar>
    );

  return (
    <QueryBoundary query={query}>
      {(org) => (
        <>
          <Outlet context={org} />
        </>
      )}
    </QueryBoundary>
  );
}
