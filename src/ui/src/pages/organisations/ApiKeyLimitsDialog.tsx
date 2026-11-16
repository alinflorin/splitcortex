import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateApiKeyLimits } from '../../api/hooks';
import type { ApiKey } from '../../api/schemas';
import { FormDialog } from '../../components/forms/FormDialog';
import { LimitsFields } from '../../components/forms/LimitsFields';
import { useToast } from '../../components/feedback/useToast';
import { EMPTY_LIMITS_TEXT, limitsToText, textToLimits } from '../../lib/limits';

/** Edit the rate limits of one API key. */
export function ApiKeyLimitsDialog({
  orgId,
  target,
  onClose,
}: {
  orgId: string;
  target: ApiKey | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateApiKeyLimits(orgId);
  const toast = useToast();
  const [text, setText] = useState(EMPTY_LIMITS_TEXT);
  useEffect(() => {
    if (target) setText(limitsToText(target.limits));
  }, [target]);

  const submit = async () => {
    const limits = textToLimits(text);
    if (!target || !limits) return;
    try {
      await update.mutateAsync({ keyId: target.id, limits });
      toast.success(t('limits.saved'));
      onClose();
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <FormDialog
      open={target !== null}
      title={t('limits.keyTitle', { name: target?.name ?? '' })}
      submitLabel={t('limits.save')}
      busy={update.isPending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <LimitsFields value={text} onChange={setText} />
    </FormDialog>
  );
}
