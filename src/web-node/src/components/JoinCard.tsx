import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { EnrollError, enroll, type EnrollErrorKind } from '../enrollment/client';
import { formatCodeInput, parseCode } from '../enrollment/crypto';
import { getOrCreateIdentity } from '../enrollment/identity';
import { saveEnrollment } from '../enrollment/store';
import { APP_VERSION, enrollmentUrl } from '../lib/config';
import { webDeviceInfo } from '../lib/device';
import { Panel } from './Panel';

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    maxWidth: '420px',
  },
  code: { fontFamily: tokens.fontFamilyMonospace, letterSpacing: '0.08em' },
  muted: { color: tokens.colorNeutralForeground3 },
});

// Messages are i18n keys, translated at render.
const schema = z.object({
  code: z.string().refine((c) => parseCode(c) !== null, 'join.errors.invalidFormat'),
});
type Values = z.infer<typeof schema>;

/** Joins this browser to a pool with the short code the web app shows (prefilled when it opened this page). */
export function JoinCard({ initialCode, onJoined }: { initialCode: string; onJoined: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [failure, setFailure] = useState<EnrollErrorKind | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { code: initialCode },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ code }) => {
    setFailure(null);
    try {
      const baseUrl = enrollmentUrl();
      const result = await enroll({
        baseUrl,
        code,
        identity: await getOrCreateIdentity(),
        device: webDeviceInfo(APP_VERSION),
      });
      await saveEnrollment({
        ...result,
        enrollmentUrl: baseUrl,
        enrolledAt: new Date().toISOString(),
      });
      onJoined();
    } catch (e) {
      setFailure(e instanceof EnrollError ? e.kind : 'server');
    }
  });

  return (
    <Panel title={t('join.title')}>
      <Text className={styles.muted}>{t('join.intro')}</Text>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label={t('join.code')}
          validationMessage={errors.code?.message ? t(errors.code.message) : undefined}
          validationState={errors.code ? 'error' : 'none'}
        >
          <Input
            {...form.register('code', {
              onChange: (e: { target: { value: string } }) =>
                form.setValue('code', formatCodeInput(e.target.value)),
            })}
            className={styles.code}
            placeholder="XXXX-XXXXXX"
            maxLength={11}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {failure && (
          <MessageBar intent="error">
            <MessageBarBody>{t(`join.errors.${failure}`)}</MessageBarBody>
          </MessageBar>
        )}
        <div>
          <Button appearance="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('join.joining') : t('join.submit')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
