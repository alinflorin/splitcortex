import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Dropdown,
  Field,
  Option,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuditLogs } from '../../api/hooks';
import type { AuditParams } from '../../api/hooks';
import type { AuditEntry } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard } from '../../components/cards/cards';
import { PageHeader } from '../../components/layout/PageHeader';
import { isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';

const CATEGORIES = [
  'all',
  'organisation',
  'member',
  'pool',
  'node',
  'model',
  'api_key',
  'enrollment',
  'benchmark',
  'limit',
] as const;
const OUTCOMES = ['all', 'success', 'denied', 'failed'] as const;

const useStyles = makeStyles({
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXL,
    '@media (max-width: 599px)': { flexDirection: 'column' },
  },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  more: { alignSelf: 'center' },
  detail: { color: tokens.colorNeutralForeground3, overflowWrap: 'anywhere' },
  muted: { color: tokens.colorNeutralForeground3 },
});

const outcomeColor = { success: 'success', denied: 'danger', failed: 'warning' } as const;

/** One short line of non-secret facts (what changed, why a node was refused...). */
function details(e: AuditEntry): string {
  const parts: string[] = [];
  if (e.entityType) parts.push(`${e.entityType}${e.entityId ? ` ${e.entityId}` : ''}`);
  for (const [k, v] of Object.entries(e.metadata ?? {}))
    parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  if (e.ip) parts.push(e.ip);
  return parts.join(' · ');
}

/** Audit log of the organisation (admins only): who did what, and what the gateway refused. */
export function AuditPage() {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const org = useOrganisationContext();
  const admin = isAdmin(org.role);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('all');

  const params: AuditParams = {
    action: category === 'all' ? undefined : `${category}.`,
    outcome: outcome === 'all' ? undefined : outcome,
  };
  const query = useAuditLogs(org.id, params, admin);
  // Members have no access (the server answers 403); do not even show the page.
  if (!admin) return <Navigate to={`/organisations/${org.id}`} replace />;

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <>
      <PageHeader eyebrow={org.name} title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <div className={styles.filters}>
        <Field label={t('audit.category')}>
          <Dropdown
            value={t(`audit.categories.${category}`)}
            selectedOptions={[category]}
            onOptionSelect={(_, d) => setCategory(d.optionValue as (typeof CATEGORIES)[number])}
          >
            {CATEGORIES.map((c) => (
              <Option key={c} value={c}>
                {t(`audit.categories.${c}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={t('audit.outcome')}>
          <Dropdown
            value={t(`audit.outcomes.${outcome}`)}
            selectedOptions={[outcome]}
            onOptionSelect={(_, d) => setOutcome(d.optionValue as (typeof OUTCOMES)[number])}
          >
            {OUTCOMES.map((o) => (
              <Option key={o} value={o}>
                {t(`audit.outcomes.${o}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
      </div>

      <QueryBoundary query={query}>
        {(data) => {
          const items = data.pages.flatMap((p) => p.items);
          if (items.length === 0) return <Body1 className={styles.muted}>{t('audit.empty')}</Body1>;
          return (
            <div className={styles.section}>
              <CardList>
                {items.map((e) => (
                  <ItemCard
                    key={e.id}
                    title={t(`audit.actions.${e.action}`, { defaultValue: e.action })}
                    subtitle={`${when(e.occurredAt)} · ${e.actorId ?? t(`audit.actors.${e.actorType}`)}`}
                    meta={
                      <>
                        <Badge appearance="tint" color={outcomeColor[e.outcome]}>
                          {t(`audit.outcomes.${e.outcome}`)}
                        </Badge>
                        {e.source === 'gateway' && (
                          <Badge appearance="outline">{t('audit.gateway')}</Badge>
                        )}
                      </>
                    }
                  >
                    {details(e) && <Body1 className={styles.detail}>{details(e)}</Body1>}
                  </ItemCard>
                ))}
              </CardList>
              {query.hasNextPage && (
                <Button
                  className={styles.more}
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  icon={query.isFetchingNextPage ? <Spinner size="tiny" /> : undefined}
                >
                  {t('audit.loadMore')}
                </Button>
              )}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
