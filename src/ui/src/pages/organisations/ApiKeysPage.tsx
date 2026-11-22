import { useState } from 'react';
import { Badge, Body1, Button, makeStyles, tokens } from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import {
  Add24Regular,
  CalendarClock20Regular,
  Delete20Regular,
  Gauge20Regular,
  Key24Regular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useApiKeys, usePools, useRevokeApiKey } from '../../api/hooks';
import { apiKeyState } from '../../api/schemas';
import type { ApiKey, ApiKeyState } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/cards/EmptyState';
import { CardList, ItemCard, Stat, StatRow } from '../../components/cards/cards';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { isAdmin } from '../../lib/roles';
import { ApiKeyExpiryDialog } from './ApiKeyExpiryDialog';
import { ApiKeyLimitsDialog } from './ApiKeyLimitsDialog';
import { ApiKeyFormDialog } from './ApiKeyFormDialog';
import { ApiKeySecretDialog } from './ApiKeySecretDialog';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
});

const STATE_COLOR: Record<ApiKeyState, BadgeProps['color']> = {
  active: 'success',
  expiring: 'warning',
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
  const [limiting, setLimiting] = useState<ApiKey | null>(null);
  const [expiring, setExpiring] = useState<ApiKey | null>(null);

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
  const limitsText = (k: ApiKey) => {
    const parts = [
      k.limits.requestsPerMinute &&
        t('limits.perMinuteRequests', { n: k.limits.requestsPerMinute }),
      k.limits.tokensPerMinute && t('limits.perMinuteTokens', { n: k.limits.tokensPerMinute }),
      k.limits.tokensPerDay && t('limits.perDayTokens', { n: k.limits.tokensPerDay }),
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : t('limits.unlimited');
  };

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={t('apiKeys.title')}
        subtitle={t('apiKeys.subtitle')}
        actions={
          <>
            <Button appearance="primary" icon={<Add24Regular />} onClick={() => setCreating(true)}>
              {t('apiKeys.new')}
            </Button>
          </>
        }
      />
      <QueryBoundary query={query}>
        {(keys) =>
          keys.length === 0 ? (
            <EmptyState
              icon={<Key24Regular />}
              text={t('apiKeys.empty')}
              actionLabel={t('apiKeys.new')}
              actionIcon={<Add24Regular />}
              onAction={() => setCreating(true)}
            />
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
                      state !== 'revoked' && (
                        <>
                          <Button
                            appearance="subtle"
                            icon={<CalendarClock20Regular />}
                            aria-label={t('apiKeys.changeExpiry')}
                            onClick={() => setExpiring(k)}
                          />
                          {state !== 'expired' && (
                            <>
                              <Button
                                appearance="subtle"
                                icon={<Gauge20Regular />}
                                aria-label={t('limits.edit')}
                                onClick={() => setLimiting(k)}
                              />
                              <Button
                                appearance="subtle"
                                icon={<Delete20Regular />}
                                aria-label={t('apiKeys.revoke')}
                                onClick={() => void onRevoke(k)}
                              />
                            </>
                          )}
                        </>
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
                      <Stat label={t('limits.title')} value={limitsText(k)} />
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
      <ApiKeyLimitsDialog orgId={org.id} target={limiting} onClose={() => setLimiting(null)} />
      <ApiKeyExpiryDialog orgId={org.id} target={expiring} onClose={() => setExpiring(null)} />
    </>
  );
}
