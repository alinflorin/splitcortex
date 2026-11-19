import { Button, Subtitle2, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { useDeleteAccount } from '../api/hooks';
import { ItemCard } from '../components/cards/cards';
import { useConfirm } from '../components/feedback/useConfirm';
import { useToast } from '../components/feedback/useToast';
import { PageHeader } from '../components/layout/PageHeader';
import { useCurrentUser } from '../auth/useCurrentUser';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXL,
    maxWidth: '480px',
  },
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

export function UserSettings() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const deleteAccount = useDeleteAccount();
  const confirm = useConfirm();
  const toast = useToast();

  const onDelete = async () => {
    const ok = await confirm({
      title: t('userSettings.deleteTitle'),
      message: t('userSettings.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAccount.mutateAsync();
      // Dex has no end_session_endpoint: drop the local session only.
      await auth.removeUser();
      queryClient.clear();
      toast.success(t('userSettings.deleted'));
      void navigate('/');
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <div className={styles.root}>
      <PageHeader title={t('userSettings.title')} subtitle={t('userSettings.subtitle')} />
      <ItemCard title={user?.name ?? ''} subtitle={user?.email} />
      <div className={styles.danger}>
        <Subtitle2>{t('organisations.dangerZone')}</Subtitle2>
        <Text className={styles.muted}>{t('userSettings.deleteMessage')}</Text>
        <div className={styles.actions}>
          <Button onClick={() => void onDelete()} disabled={deleteAccount.isPending}>
            {t('userSettings.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
