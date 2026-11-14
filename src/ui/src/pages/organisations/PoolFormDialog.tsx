import { Checkbox, Field } from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreatePool, useUpdatePool } from '../../api/hooks';
import { poolFormSchema } from '../../api/schemas';
import type { Pool, PoolForm } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { FormDialog } from '../../components/forms/FormDialog';
import { TextField } from '../../components/forms/TextField';

interface PoolFormDialogProps {
  orgId: string;
  /** `'new'` = create, a pool = edit, `null` = closed. */
  target: Pool | 'new' | null;
  onClose: () => void;
}

/** Create / edit dialog shared by the pool list and the pool screen. */
export function PoolFormDialog({ orgId, target, onClose }: PoolFormDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreatePool(orgId);
  const update = useUpdatePool(orgId);
  const form = useForm<PoolForm>({
    resolver: zodResolver(poolFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '', requireApproval: false },
  });

  const { reset } = form;
  useEffect(() => {
    if (target === null) return;
    reset(
      target === 'new'
        ? { name: '', requireApproval: false }
        : { name: target.name, requireApproval: target.requireApproval },
    );
  }, [target, reset]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (target === 'new') await create.mutateAsync(values);
      else if (target) await update.mutateAsync({ poolId: target.id, ...values });
      toast.success(t(target === 'new' ? 'pools.created' : 'pools.updated'));
      onClose();
    } catch {
      // the mutation cache already showed an error toast; keep the dialog open
    }
  });

  return (
    <FormDialog
      open={target !== null}
      title={target === 'new' ? t('pools.new') : t('pools.edit')}
      submitLabel={target === 'new' ? t('common.create') : t('common.save')}
      busy={create.isPending || update.isPending}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
    >
      <TextField control={form.control} name="name" label={t('pools.name')} autoFocus />
      <Controller
        name="requireApproval"
        control={form.control}
        render={({ field }) => (
          <Field hint={t('pools.approvalHint')}>
            <Checkbox
              checked={field.value}
              onChange={(_, d) => field.onChange(d.checked === true)}
              label={t('pools.approval')}
            />
          </Field>
        )}
      />
    </FormDialog>
  );
}
