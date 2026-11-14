import {
  Badge,
  MessageBar,
  MessageBarBody,
  Title1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useOrganisation } from '../../api/hooks';
import { ApiError } from '../../api/client';
import type { Organisation } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    marginBottom: tokens.spacingVerticalXL,
  },
  title: { overflowWrap: 'anywhere', minWidth: 0 },
});

export function useOrganisationContext() {
  return useOutletContext<Organisation>();
}

/** Page frame for an organisation; navigation between its pages lives in the sidebar (see OrgNav). */
export function OrganisationLayout() {
  const styles = useStyles();
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
          <div className={styles.header}>
            <Title1 className={styles.title}>{org.name}</Title1>
            <Badge appearance="tint">{t(`roles.${org.role}`)}</Badge>
          </div>
          <Outlet context={org} />
        </>
      )}
    </QueryBoundary>
  );
}
