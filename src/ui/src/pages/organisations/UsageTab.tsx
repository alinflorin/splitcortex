import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/layout/PageHeader';
import { UsageView } from './UsageView';
import { useOrganisationContext } from './OrganisationLayout';

export function UsageTab() {
  const { t } = useTranslation();
  const org = useOrganisationContext();
  return (
    <>
      <PageHeader title={t('usage.title')} subtitle={t('usage.subtitle')} />
      <UsageView orgId={org.id} />
    </>
  );
}
