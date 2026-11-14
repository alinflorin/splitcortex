import { UsageView } from './UsageView';
import { useOrganisationContext } from './OrganisationLayout';

export function UsageTab() {
  const org = useOrganisationContext();
  return <UsageView orgId={org.id} />;
}
