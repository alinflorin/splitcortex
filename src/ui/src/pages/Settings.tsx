import { useState } from 'react';
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Text,
  Title1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useCurrentUser } from '../auth/useCurrentUser';

// Messages are i18n keys; they are translated where they are rendered.
const settingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .min(2, { error: 'validation.nameMin' })
    .max(50, { error: 'validation.nameMax' }),
  contactEmail: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .pipe(z.email({ error: 'validation.email' })),
});
type SettingsForm = z.infer<typeof settingsSchema>;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    maxWidth: '480px',
  },
  muted: { color: tokens.colorNeutralForeground3 },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
    marginTop: tokens.spacingVerticalXL,
  },
  actions: { display: 'flex' },
});

export function Settings() {
  const styles = useStyles();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const [saved, setSaved] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    // Validate when a field is blurred for the first time, then live while it is being corrected.
    mode: 'onTouched',
    defaultValues: { displayName: user?.name ?? '', contactEmail: user?.email ?? '' },
  });

  const onSubmit = (values: SettingsForm) => {
    // TODO: persist through the control plane API once it exists.
    reset(values);
    setSaved(true);
  };

  return (
    <div className={styles.root}>
      <Title1>{t('settings.title')}</Title1>
      <Text className={styles.muted}>{t('settings.subtitle')}</Text>
      {user?.email && (
        <Text className={styles.muted} size={200}>
          {t('settings.signedInAs', { email: user.email })}
        </Text>
      )}

      <form className={styles.form} noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
        <Controller
          name="displayName"
          control={control}
          render={({ field, fieldState }) => (
            <Field
              label={t('settings.displayName')}
              required
              validationState={fieldState.error ? 'error' : 'none'}
              validationMessage={
                fieldState.error?.message ? t(fieldState.error.message) : undefined
              }
            >
              <Input
                {...field}
                onChange={(_, d) => {
                  setSaved(false);
                  field.onChange(d.value);
                }}
              />
            </Field>
          )}
        />
        <Controller
          name="contactEmail"
          control={control}
          render={({ field, fieldState }) => (
            <Field
              label={t('settings.contactEmail')}
              required
              validationState={fieldState.error ? 'error' : 'none'}
              validationMessage={
                fieldState.error?.message ? t(fieldState.error.message) : undefined
              }
            >
              <Input
                {...field}
                type="email"
                onChange={(_, d) => {
                  setSaved(false);
                  field.onChange(d.value);
                }}
              />
            </Field>
          )}
        />
        {saved && (
          <MessageBar intent="success">
            <MessageBarBody>{t('settings.saved')}</MessageBarBody>
          </MessageBar>
        )}
        <div className={styles.actions}>
          <Button appearance="primary" type="submit" disabled={isSubmitting}>
            {t('settings.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
