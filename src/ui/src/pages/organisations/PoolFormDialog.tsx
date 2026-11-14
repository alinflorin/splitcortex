import { Checkbox, Dropdown, Field, Option } from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreatePool, useUpdatePool } from '../../api/hooks';
import { BALANCING_TYPES, poolFormSchema } from '../../api/schemas';
import type { BalancingType, Pool, PoolForm } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { FormDialog } from '../../components/forms/FormDialog';
import { TextField } from '../../components/forms/TextField';

const DEFAULTS: PoolForm = {
  name: '',
  requireApproval: false,
  servingType: 'replicated',
  balancingType: 'weighted_p2c',
};

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
    defaultValues: DEFAULTS,
  });

  const { reset } = form;
  useEffect(() => {
    if (target === null) return;
    reset(
      target === 'new'
        ? DEFAULTS
        : {
            name: target.name,
            requireApproval: target.requireApproval,
            servingType: target.servingType,
            balancingType: target.balancingType,
          },
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
        name="servingType"
        control={form.control}
        render={({ field }) => (
          <Field label={t('pools.serving.label')} hint={t(`pools.serving.${field.value}Hint`)}>
            <Dropdown
              value={t(`pools.serving.${field.value}`)}
              selectedOptions={[field.value]}
              onOptionSelect={(_, d) => field.onChange(d.optionValue)}
            >
              <Option value="replicated">{t('pools.serving.replicated')}</Option>
            </Dropdown>
          </Field>
        )}
      />
      <Controller
        name="balancingType"
        control={form.control}
        render={({ field }) => (
          <Field label={t('pools.balancing.label')} hint={t(`pools.balancing.${field.value}Hint`)}>
            <Dropdown
              value={t(`pools.balancing.${field.value}`)}
              selectedOptions={[field.value]}
              onOptionSelect={(_, d) => field.onChange(d.optionValue as BalancingType)}
            >
              {BALANCING_TYPES.map((b) => (
                <Option key={b} value={b} text={t(`pools.balancing.${b}`)}>
                  {t(`pools.balancing.${b}`)}
                </Option>
              ))}
            </Dropdown>
          </Field>
        )}
      />
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
