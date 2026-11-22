import { useState } from 'react';
import { Button } from '@fluentui/react-components';
import { Add24Regular, BrainCircuit24Regular, Delete20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useDeleteModel, useModels, useRetryModel } from '../../api/hooks';
import type { Model } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/cards/EmptyState';
import { CardList } from '../../components/cards/cards';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { isAdmin } from '../../lib/roles';
import { AddModelDialog } from './AddModelDialog';
import { ModelCard } from './ModelCard';
import { useOrganisationContext } from './OrganisationLayout';

export function ModelsPage() {
  const { t } = useTranslation();
  const org = useOrganisationContext();
  const admin = isAdmin(org.role);
  const query = useModels(org.id);
  const retry = useRetryModel(org.id);
  const remove = useDeleteModel(org.id);
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const onDelete = async (model: Model) => {
    const ok = await confirm({
      title: t('models.deleteTitle', { name: model.name }),
      message: t('models.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(model.id);
      toast.success(t('models.deleted'));
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={t('models.title')}
        subtitle={t('models.subtitle')}
        actions={
          admin ? (
            <>
              <Button appearance="primary" icon={<Add24Regular />} onClick={() => setAdding(true)}>
                {t('models.add')}
              </Button>
            </>
          ) : undefined
        }
      />
      <QueryBoundary query={query}>
        {(models) =>
          models.length === 0 ? (
            <EmptyState
              icon={<BrainCircuit24Regular />}
              text={t('models.empty')}
              actionLabel={admin ? t('models.add') : undefined}
              actionIcon={<Add24Regular />}
              onAction={() => setAdding(true)}
            />
          ) : (
            <CardList>
              {models.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  onRetry={admin ? () => retry.mutate(m.id) : undefined}
                  actions={
                    admin && (
                      <Button
                        appearance="subtle"
                        icon={<Delete20Regular />}
                        aria-label={t('common.delete')}
                        onClick={() => void onDelete(m)}
                      />
                    )
                  }
                />
              ))}
            </CardList>
          )
        }
      </QueryBoundary>
      <AddModelDialog orgId={org.id} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
