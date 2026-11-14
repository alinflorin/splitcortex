import { useTranslation } from 'react-i18next';
import { useDeletePool } from '../../api/hooks';
import type { Pool } from '../../api/schemas';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';

/** Returns `deletePool(pool)`: asks for confirmation, deletes, toasts; resolves true when deleted. */
export function useDeletePoolAction(orgId: string) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const remove = useDeletePool(orgId);

  return async (pool: Pool): Promise<boolean> => {
    const ok = await confirm({
      title: t('pools.deleteTitle', { name: pool.name }),
      message: t('pools.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return false;
    try {
      await remove.mutateAsync(pool.id);
      toast.success(t('pools.deleted'));
      return true;
    } catch {
      return false; // error toast shown by the mutation cache
    }
  };
}
