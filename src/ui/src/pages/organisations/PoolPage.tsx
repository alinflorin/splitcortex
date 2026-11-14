import { useState } from 'react';
import { Badge, Button, Subtitle1, Title2, makeStyles, tokens } from '@fluentui/react-components';
import { Delete20Regular, Edit20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePool } from '../../api/hooks';
import { QueryBoundary } from '../../components/QueryBoundary';
import { ItemCard, Stat, StatRow } from '../../components/cards/cards';
import { isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';
import { PoolFormDialog } from './PoolFormDialog';
import { PoolModels, PoolNodes } from './PoolSections';
import { UsageView } from './UsageView';
import { useDeletePoolAction } from './useDeletePoolAction';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXL },
  back: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalM,
  },
  title: { flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

/** One pool: its settings, its devices (once enrollment exists) and its usage. */
export function PoolPage() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useOrganisationContext();
  const { poolId = '' } = useParams();
  const admin = isAdmin(org.role);
  const query = usePool(org.id, poolId);
  const deletePool = useDeletePoolAction(org.id);
  const [editing, setEditing] = useState(false);

  return (
    <div className={styles.root}>
      <Link to={`/organisations/${org.id}/pools`} className={styles.back}>
        ← {t('pools.title')}
      </Link>
      <QueryBoundary query={query}>
        {(pool) => (
          <>
            <div className={styles.header}>
              <Title2 className={styles.title}>{pool.name}</Title2>
              <Badge appearance="tint" color={pool.requireApproval ? 'warning' : 'subtle'}>
                {t(pool.requireApproval ? 'pools.approvalOn' : 'pools.approvalOff')}
              </Badge>
              {admin && (
                <div className={styles.actions}>
                  <Button icon={<Edit20Regular />} onClick={() => setEditing(true)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    icon={<Delete20Regular />}
                    onClick={() =>
                      void deletePool(pool).then(
                        (deleted) => deleted && navigate(`/organisations/${org.id}/pools`),
                      )
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              )}
            </div>

            <ItemCard title={t('pools.details')}>
              <StatRow>
                <Stat label={t('pools.name')} value={pool.name} />
                <Stat
                  label={t('pools.approval')}
                  value={t(pool.requireApproval ? 'pools.approvalOn' : 'pools.approvalOff')}
                />
                <Stat
                  label={t('common.created')}
                  value={new Date(pool.createdAt).toLocaleString()}
                />
              </StatRow>
            </ItemCard>

            <section className={styles.section}>
              <Subtitle1>{t('pools.devices')}</Subtitle1>
              <PoolNodes pool={pool} />
            </section>

            <section className={styles.section}>
              <Subtitle1>{t('pools.models')}</Subtitle1>
              <PoolModels pool={pool} admin={admin} />
            </section>

            <section className={styles.section}>
              <Subtitle1>{t('usage.title')}</Subtitle1>
              <UsageView orgId={org.id} poolId={pool.id} />
            </section>

            <PoolFormDialog
              orgId={org.id}
              target={editing ? pool : null}
              onClose={() => setEditing(false)}
            />
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
