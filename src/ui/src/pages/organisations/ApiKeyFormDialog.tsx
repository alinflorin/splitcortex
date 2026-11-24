import {
  Checkbox,
  Dropdown,
  Field,
  Label,
  Option,
  Radio,
  RadioGroup,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreateApiKey, usePools } from '../../api/hooks';
import { API_KEY_EXPIRIES, apiKeyFormSchema } from '../../api/schemas';
import type { ApiKeyForm, CreatedApiKey } from '../../api/schemas';
import { FormDialog } from '../../components/forms/FormDialog';
import { LimitsFields } from '../../components/forms/LimitsFields';
import { TextField } from '../../components/forms/TextField';
import { EMPTY_LIMITS_TEXT, textToLimits } from '../../lib/limits';

const DEFAULTS: ApiKeyForm = { name: '', scope: 'org', poolIds: [], expiry: 'never' };

const useStyles = makeStyles({
  pools: { display: 'flex', flexDirection: 'column' },
  error: { color: tokens.colorPaletteRedForeground1 },
  radioHint: {
    // Lines up under the radio's label, not under its circle.
    marginLeft: '28px',
    marginTop: `-${tokens.spacingVerticalXS}`,
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  orgId: string;
  open: boolean;
  onClose: () => void;
  /** Called with the new key and its one-time secret. */
  onCreated: (created: CreatedApiKey) => void;
}

/** Create an API key: a name, access (whole organisation or chosen pools) and an optional expiry. */
export function ApiKeyFormDialog({ orgId, open, onClose, onCreated }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const create = useCreateApiKey(orgId);
  const pools = usePools(orgId);
  const form = useForm<ApiKeyForm>({
    resolver: zodResolver(apiKeyFormSchema),
    mode: 'onTouched',
    defaultValues: DEFAULTS,
  });
  const scope = form.watch('scope');
  const [limitsText, setLimitsText] = useState(EMPTY_LIMITS_TEXT);

  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(DEFAULTS);
      setLimitsText(EMPTY_LIMITS_TEXT);
    }
  }, [open, reset]);

  const submit = form.handleSubmit(async (values) => {
    const limits = textToLimits(limitsText);
    if (!limits) return; // the invalid field is flagged in the dialog
    const any = Object.values(limits).some((v) => v !== null);
    try {
      onCreated(await create.mutateAsync({ form: values, limits: any ? limits : undefined }));
    } catch {
      // the mutation cache already showed an error toast; keep the dialog open
    }
  });

  return (
    <FormDialog
      open={open}
      title={t('apiKeys.new')}
      submitLabel={t('common.create')}
      busy={create.isPending}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
    >
      <TextField control={form.control} name="name" label={t('apiKeys.name')} autoFocus />
      <Controller
        name="scope"
        control={form.control}
        render={({ field }) => (
          <Field label={t('apiKeys.scope')}>
            <RadioGroup value={field.value} onChange={(_, d) => field.onChange(d.value)}>
              <Radio value="org" label={t('apiKeys.scopeOrg')} />
              <Text size={200} className={styles.radioHint}>
                {t('apiKeys.scopeOrgHint')}
              </Text>
              <Radio value="pools" label={t('apiKeys.scopePools')} />
              <Text size={200} className={styles.radioHint}>
                {t('apiKeys.scopePoolsHint')}
              </Text>
            </RadioGroup>
          </Field>
        )}
      />
      {scope === 'pools' && (
        <Controller
          name="poolIds"
          control={form.control}
          render={({ field, fieldState }) => (
            // Not a Field: its label would also point at every checkbox inside and double their names.
            <div role="group" aria-labelledby="api-key-pools" className={styles.pools}>
              <Label id="api-key-pools">{t('apiKeys.pools')}</Label>
              {pools.data?.length === 0 && <Text>{t('apiKeys.noPools')}</Text>}
              {pools.data?.map((p) => (
                <Checkbox
                  key={p.id}
                  label={p.name}
                  checked={field.value.includes(p.id)}
                  onChange={(_, d) =>
                    field.onChange(
                      d.checked ? [...field.value, p.id] : field.value.filter((id) => id !== p.id),
                    )
                  }
                />
              ))}
              {fieldState.error?.message && (
                <Text role="alert" className={styles.error}>
                  {t(fieldState.error.message)}
                </Text>
              )}
            </div>
          )}
        />
      )}
      <Controller
        name="expiry"
        control={form.control}
        render={({ field }) => (
          <Field label={t('apiKeys.expiry')}>
            <Dropdown
              value={t(field.value === 'never' ? 'apiKeys.never' : `apiKeys.days_${field.value}`)}
              selectedOptions={[field.value]}
              onOptionSelect={(_, d) => field.onChange(d.optionValue)}
            >
              {API_KEY_EXPIRIES.map((e) => {
                const label = t(e === 'never' ? 'apiKeys.never' : `apiKeys.days_${e}`);
                return (
                  <Option key={e} value={e} text={label}>
                    {label}
                  </Option>
                );
              })}
            </Dropdown>
          </Field>
        )}
      />
      <LimitsFields value={limitsText} onChange={setLimitsText} />
    </FormDialog>
  );
}
