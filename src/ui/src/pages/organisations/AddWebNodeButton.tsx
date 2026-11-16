import { Button } from '@fluentui/react-components';
import { Globe20Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useCreateEnrollment } from '../../api/hooks';
import type { Pool } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { getWebNodeUrl, webNodeJoinUrl } from '../../lib/webNode';

/**
 * Creates a join code for the pool and opens the web node (a browser tab that serves like a phone node) with the code
 * filled in. The tab is opened on the click and pointed at the link once the code exists, so popup blockers allow it;
 * if the browser blocks it anyway, this tab goes to the web node instead.
 */
export function AddWebNodeButton({ pool }: { pool: Pool }) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateEnrollment(pool.orgId, pool.id);

  const open = () => {
    const tab = window.open('', '_blank');
    create.mutate(undefined, {
      onSuccess: ({ code }) => {
        const url = webNodeJoinUrl(getWebNodeUrl(), code);
        if (tab) {
          tab.opener = null; // the web node must not be able to reach back into this app
          tab.location.href = url;
          toast.success(t('enroll.webNodeOpened'));
        } else {
          window.location.assign(url);
        }
      },
      onError: () => tab?.close(),
    });
  };

  return (
    <Button icon={<Globe20Regular />} disabled={create.isPending} onClick={open}>
      {t('enroll.addWebNode')}
    </Button>
  );
}
