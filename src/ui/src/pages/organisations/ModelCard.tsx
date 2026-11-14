import { Button, ProgressBar, Text, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Model } from '../../api/schemas';
import { ItemCard } from '../../components/cards/cards';
import { ModelStatusBadge } from '../../components/status/StatusBadge';
import { formatBytes } from '../../lib/format';

const useStyles = makeStyles({
  progress: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    width: '100%',
  },
  error: { color: tokens.colorPaletteRedForeground1, overflowWrap: 'anywhere' },
});

/** One model: name, file and size, status (with download progress) and optional actions (retry, delete...). */
export function ModelCard({
  model,
  actions,
  onRetry,
}: {
  model: Model;
  actions?: ReactNode;
  onRetry?: () => void;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const size = model.sizeBytes != null ? formatBytes(model.sizeBytes, i18n.language) : null;
  const downloading = model.status === 'downloading' || model.status === 'pending';

  return (
    <ItemCard
      title={model.name}
      subtitle={[model.fileName, size, t(`models.source.${model.source}`)]
        .filter(Boolean)
        .join(' · ')}
      meta={<ModelStatusBadge status={model.status} />}
      actions={
        <>
          {model.status === 'failed' && onRetry && (
            <Button
              appearance="subtle"
              icon={<ArrowClockwise20Regular />}
              aria-label={t('models.retry')}
              onClick={onRetry}
            />
          )}
          {actions}
        </>
      }
    >
      {downloading && (
        <div className={styles.progress}>
          <ProgressBar
            value={model.sizeBytes ? model.progressBytes / model.sizeBytes : undefined}
            thickness="large"
            aria-label={t('models.progress')}
          />
          {model.sizeBytes ? (
            <Text size={200}>
              {formatBytes(model.progressBytes, i18n.language)} / {size}
            </Text>
          ) : null}
        </div>
      )}
      {model.status === 'failed' && model.error && (
        <Text size={200} className={styles.error}>
          {model.error}
        </Text>
      )}
    </ItemCard>
  );
}
