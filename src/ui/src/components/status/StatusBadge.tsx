import { Badge } from '@fluentui/react-components';
import type { BadgeProps } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import type { ModelStatus, NodeStatus } from '../../api/schemas';

const NODE_COLOR: Record<NodeStatus, BadgeProps['color']> = {
  online: 'success',
  offline: 'subtle',
  pending: 'warning',
};
const MODEL_COLOR: Record<ModelStatus, BadgeProps['color']> = {
  ready: 'success',
  pending: 'informative',
  downloading: 'informative',
  uploading: 'informative',
  failed: 'danger',
};

export function NodeStatusBadge({ status }: { status: NodeStatus }) {
  const { t } = useTranslation();
  return (
    <Badge appearance="tint" color={NODE_COLOR[status]}>
      {t(`nodes.status.${status}`)}
    </Badge>
  );
}

export function ModelStatusBadge({ status }: { status: ModelStatus }) {
  const { t } = useTranslation();
  return (
    <Badge appearance="tint" color={MODEL_COLOR[status]}>
      {t(`models.status.${status}`)}
    </Badge>
  );
}
