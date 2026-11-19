import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/layout/PageHeader';
import { MetricsView } from './MetricsView';
import { useOrganisationContext } from './OrganisationLayout';

export function MetricsTab() {
  const { t } = useTranslation();
  const org = useOrganisationContext();
  return (
    <>
      <PageHeader eyebrow={org.name} title={t('metrics.title')} subtitle={t('metrics.subtitle')} />
      <MetricsView orgId={org.id} />
    </>
  );
}
