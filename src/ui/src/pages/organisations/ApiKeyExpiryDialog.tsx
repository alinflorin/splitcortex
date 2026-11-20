import { useEffect, useState } from 'react';
import { Dropdown, Field, Option } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { useUpdateApiKeyExpiry } from '../../api/hooks';
import { API_KEY_EXPIRIES, apiKeyExpiryFromChoice } from '../../api/schemas';
import type { ApiKey } from '../../api/schemas';
import { FormDialog } from '../../components/forms/FormDialog';
import { useToast } from '../../components/feedback/useToast';

type Choice = (typeof API_KEY_EXPIRIES)[number];

/** Extend, shorten or clear the expiry of one API key (counted from now). */
export function ApiKeyExpiryDialog({
  orgId,
  target,
  onClose,
}: {
  orgId: string;
  target: ApiKey | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateApiKeyExpiry(orgId);
  const toast = useToast();
  const [choice, setChoice] = useState<Choice>('90');
  useEffect(() => {
    if (target) setChoice(target.expiresAt ? '90' : 'never');
  }, [target]);

  const label = (e: Choice) => t(e === 'never' ? 'apiKeys.never' : `apiKeys.days_${e}`);

  const submit = async () => {
    if (!target) return;
    try {
      await update.mutateAsync({ keyId: target.id, expiresAt: apiKeyExpiryFromChoice(choice) });
      toast.success(t('apiKeys.expirySaved'));
      onClose();
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <FormDialog
      open={target !== null}
      title={t('apiKeys.expiryTitle', { name: target?.name ?? '' })}
      submitLabel={t('apiKeys.expirySave')}
      busy={update.isPending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={t('apiKeys.expiry')} hint={t('apiKeys.expiryHint')}>
        <Dropdown
          value={label(choice)}
          selectedOptions={[choice]}
          onOptionSelect={(_, d) => setChoice(d.optionValue as Choice)}
        >
          {API_KEY_EXPIRIES.map((e) => (
            <Option key={e} value={e} text={label(e)}>
              {label(e)}
            </Option>
          ))}
        </Dropdown>
      </Field>
    </FormDialog>
  );
}
