import { Button, Subtitle2, Text, makeStyles, tokens } from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useDeleteOrganisation, useUpdateOrganisation } from '../../api/hooks';
import { organisationFormSchema } from '../../api/schemas';
import type { OrganisationForm } from '../../api/schemas';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { TextField } from '../../components/forms/TextField';
import { isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXL,
    maxWidth: '480px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  actions: { display: 'flex' },
  danger: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorPaletteRedBorder1}`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function OrganisationSettingsTab() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useOrganisationContext();
  const update = useUpdateOrganisation(org.id);
  const remove = useDeleteOrganisation(org.id);
  const confirm = useConfirm();
  const toast = useToast();

  const form = useForm<OrganisationForm>({
    resolver: zodResolver(organisationFormSchema),
    mode: 'onTouched',
    defaultValues: { name: org.name, slug: org.slug },
  });

  if (!isAdmin(org.role)) return <Navigate to={`/organisations/${org.id}/models`} replace />;

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      form.reset({ name: saved.name, slug: saved.slug });
      toast.success(t('settings.saved'));
    } catch {
      // error toast shown by the mutation cache
    }
  });

  const onDelete = async () => {
    const ok = await confirm({
      title: t('organisations.deleteTitle', { name: org.name }),
      message: t('organisations.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success(t('organisations.deleted'));
      void navigate('/organisations');
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <div className={styles.root}>
      <form className={styles.form} noValidate onSubmit={(e) => void submit(e)}>
        <TextField control={form.control} name="name" label={t('organisations.name')} />
        <TextField control={form.control} name="slug" label={t('organisations.slug')} />
        <div className={styles.actions}>
          <Button
            appearance="primary"
            type="submit"
            disabled={update.isPending || !form.formState.isDirty}
          >
            {t('settings.save')}
          </Button>
        </div>
      </form>

      {org.role === 'owner' && (
        <div className={styles.danger}>
          <Subtitle2>{t('organisations.dangerZone')}</Subtitle2>
          <Text className={styles.muted}>{t('organisations.deleteMessage')}</Text>
          <div className={styles.actions}>
            <Button onClick={() => void onDelete()} disabled={remove.isPending}>
              {t('organisations.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
