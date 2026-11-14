import { useState } from 'react';
import { Badge, Body1, Button, makeStyles, tokens } from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import { Add24Regular, Delete20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useApiKeys, usePools, useRevokeApiKey } from '../../api/hooks';
import { apiKeyState } from '../../api/schemas';
import type { ApiKey, ApiKeyState } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard, Stat, StatRow } from '../../components/cards/cards';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { isAdmin } from '../../lib/roles';
import { ApiKeyFormDialog } from './ApiKeyFormDialog';
import { ApiKeySecretDialog } from './ApiKeySecretDialog';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  toolbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

const STATE_COLOR: Record<ApiKeyState, BadgeProps['color']> = {
  active: 'success',
  revoked: 'danger',
  expired: 'subtle',
};

export function ApiKeysPage() {
  const styles = useStyles();
  const { t } = useTranslation();
  const org = useOrganisationContext();
  const admin = isAdmin(org.role);
  const query = useApiKeys(org.id, admin);
  const pools = usePools(org.id);
  const revoke = useRevokeApiKey(org.id);
  const confirm = useConfirm();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  // Keys are admin-only on the server; show nothing to plain members instead of an error.
  if (!admin) return <Body1 className={styles.muted}>{t('apiKeys.adminOnly')}</Body1>;

  const poolNames = new Map(pools.data?.map((p) => [p.id, p.name]));
  const scopeText = (k: ApiKey) => {
    if (k.allPools) return t('apiKeys.allPools');
    if (k.poolIds.length === 0) return t('apiKeys.noPoolsLeft');
    const names = k.poolIds.map((id) => poolNames.get(id)).filter(Boolean);
    return names.length === k.poolIds.length && names.length <= 3
      ? names.join(', ')
      : t('apiKeys.poolCount', { count: k.poolIds.length });
  };

  const onRevoke = async (key: ApiKey) => {
    const ok = await confirm({
      title: t('apiKeys.revokeTitle', { name: key.name }),
      message: t('apiKeys.revokeMessage'),
      confirmLabel: t('apiKeys.revoke'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(key.id);
      toast.success(t('apiKeys.revoked'));
    } catch {
      // error toast shown by the mutation cache
    }
  };

  const date = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <>
      <div className={styles.toolbar}>
        <Button appearance="primary" icon={<Add24Regular />} onClick={() => setCreating(true)}>
          {t('apiKeys.new')}
        </Button>
      </div>
      <QueryBoundary query={query}>
        {(keys) =>
          keys.length === 0 ? (
            <Body1 className={styles.muted}>{t('apiKeys.empty')}</Body1>
          ) : (
            <CardList>
              {keys.map((k) => {
                const state = apiKeyState(k);
                return (
                  <ItemCard
                    key={k.id}
                    title={k.name}
                    subtitle={`${k.prefix}… · ${scopeText(k)}`}
                    meta={
                      <Badge appearance="tint" color={STATE_COLOR[state]}>
                        {t(`apiKeys.status.${state}`)}
                      </Badge>
                    }
                    actions={
                      state === 'active' && (
                        <Button
                          appearance="subtle"
                          icon={<Delete20Regular />}
                          aria-label={t('apiKeys.revoke')}
                          onClick={() => void onRevoke(k)}
                        />
                      )
                    }
                  >
                    <StatRow>
                      <Stat label={t('common.created')} value={date(k.createdAt)} />
                      <Stat label={t('apiKeys.createdBy')} value={k.createdBy} />
                      <Stat
                        label={t('apiKeys.lastUsed')}
                        value={k.lastUsedAt ? date(k.lastUsedAt) : t('apiKeys.neverUsed')}
                      />
                      <Stat
                        label={t('apiKeys.expires')}
                        value={k.expiresAt ? date(k.expiresAt) : t('apiKeys.never')}
                      />
                    </StatRow>
                  </ItemCard>
                );
              })}
            </CardList>
          )
        }
      </QueryBoundary>
      <ApiKeyFormDialog
        orgId={org.id}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          setSecret(created.secret);
          toast.success(t('apiKeys.created'));
        }}
      />
      <ApiKeySecretDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}
