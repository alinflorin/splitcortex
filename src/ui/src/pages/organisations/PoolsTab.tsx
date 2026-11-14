import { useState } from 'react';
import { Badge, Body1, Button, makeStyles, tokens } from '@fluentui/react-components';
import { Add24Regular, Delete20Regular, Edit20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePools } from '../../api/hooks';
import type { Pool } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard } from '../../components/cards/cards';
import { isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';
import { PoolFormDialog } from './PoolFormDialog';
import { useDeletePoolAction } from './useDeletePoolAction';

const useStyles = makeStyles({
  toolbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function PoolsTab() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useOrganisationContext();
  const admin = isAdmin(org.role);
  const query = usePools(org.id);
  const deletePool = useDeletePoolAction(org.id);
  const [editing, setEditing] = useState<Pool | 'new' | null>(null);

  return (
    <>
      {admin && (
        <div className={styles.toolbar}>
          <Button appearance="primary" icon={<Add24Regular />} onClick={() => setEditing('new')}>
            {t('pools.new')}
          </Button>
        </div>
      )}

      <QueryBoundary query={query}>
        {(pools) =>
          pools.length === 0 ? (
            <Body1 className={styles.muted}>{t('pools.empty')}</Body1>
          ) : (
            <CardList>
              {pools.map((pool) => (
                <ItemCard
                  key={pool.id}
                  title={pool.name}
                  subtitle={`${t('common.created')} ${new Date(pool.createdAt).toLocaleDateString()}`}
                  onClick={() => void navigate(`/organisations/${org.id}/pools/${pool.id}`)}
                  meta={
                    <Badge appearance="tint" color={pool.requireApproval ? 'warning' : 'subtle'}>
                      {t(pool.requireApproval ? 'pools.approvalOn' : 'pools.approvalOff')}
                    </Badge>
                  }
                  actions={
                    admin && (
                      <>
                        <Button
                          appearance="subtle"
                          icon={<Edit20Regular />}
                          aria-label={t('common.edit')}
                          onClick={() => setEditing(pool)}
                        />
                        <Button
                          appearance="subtle"
                          icon={<Delete20Regular />}
                          aria-label={t('common.delete')}
                          onClick={() => void deletePool(pool)}
                        />
                      </>
                    )
                  }
                />
              ))}
            </CardList>
          )
        }
      </QueryBoundary>

      <PoolFormDialog orgId={org.id} target={editing} onClose={() => setEditing(null)} />
    </>
  );
}
