import { Field, Input, Select, Switch, makeStyles, tokens } from '@fluentui/react-components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runtime } from '../runtime';
import {
  computePrefs,
  MAX_CONTEXT,
  MIN_CONTEXT,
  parseContext,
  useNodeSettings,
  type ComputeChoice,
} from '../runtime/settings';
import { Panel } from './Panel';

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    maxWidth: '420px',
  },
});

/** This browser's own compute settings. An admin's override for the device (web app) wins over them. */
export function SettingsCard() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { settings, update } = useNodeSettings();
  const [ctx, setCtx] = useState<string | null>(null);
  if (!settings) return null;

  const shown = ctx ?? (settings.maxContextTokens > 0 ? String(settings.maxContextTokens) : '');
  const parsed = parseContext(shown);

  // Saved on blur: every change reloads the model.
  const saveContext = () => {
    if (parsed === null) return;
    setCtx(null);
    if (parsed === settings.maxContextTokens) return;
    update({ maxContextTokens: parsed });
    runtime.setLocalCompute(computePrefs({ ...settings, maxContextTokens: parsed }));
  };

  return (
    <Panel title={t('settings.title')}>
      <div className={styles.form}>
        <Field label={t('settings.compute')} hint={t('settings.computeHint')}>
          <Select
            value={settings.compute}
            onChange={(_, d) => {
              const compute = d.value as ComputeChoice;
              update({ compute });
              runtime.setLocalCompute(computePrefs({ ...settings, compute }));
            }}
          >
            <option value="auto">{t('settings.auto')}</option>
            <option value="cpu">CPU</option>
            <option value="gpu">GPU (WebGPU)</option>
          </Select>
        </Field>
        <Field
          label={t('settings.context')}
          hint={t('settings.contextHint', { min: MIN_CONTEXT, max: MAX_CONTEXT })}
          validationMessage={
            parsed === null
              ? t('settings.contextInvalid', { min: MIN_CONTEXT, max: MAX_CONTEXT })
              : undefined
          }
          validationState={parsed === null ? 'error' : 'none'}
        >
          <Input
            value={shown}
            inputMode="numeric"
            placeholder={t('settings.auto')}
            onChange={(_, d) => setCtx(d.value)}
            onBlur={saveContext}
          />
        </Field>
        <Switch
          checked={settings.keepScreenOn}
          label={t('settings.keepScreenOn')}
          onChange={(_, d) => {
            update({ keepScreenOn: d.checked });
            runtime.setLocalScreen(d.checked);
          }}
        />
        <Switch
          checked={settings.connectOnStart}
          label={t('settings.connectOnStart')}
          onChange={(_, d) => update({ connectOnStart: d.checked })}
        />
      </div>
    </Panel>
  );
}
