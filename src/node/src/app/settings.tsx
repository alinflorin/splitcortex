import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryExemption } from '../components/BatteryExemption';
import { Card } from '../components/Card';
import { ChoiceGroup } from '../components/ChoiceGroup';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/ToggleRow';
import { LANGUAGES, setLanguage, type Language } from '../i18n';
import { runtime } from '../runtime';
import {
  MAX_CONTEXT,
  MIN_CONTEXT,
  computePrefs,
  parseContext,
  useNodeSettings,
  type ComputeChoice,
  type NodeSettings,
} from '../runtime/settings';
import { THEME_PREFERENCES, useTheme } from '../theme/ThemeContext';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  const { settings, update: updateSettings } = useNodeSettings();
  // Compute changes also reach the running engine (it reloads the model when the effective settings change).
  const update = (patch: Partial<NodeSettings>) => {
    updateSettings(patch);
    if (settings && (patch.compute !== undefined || patch.maxContextTokens !== undefined))
      runtime.setLocalCompute(computePrefs({ ...settings, ...patch }));
  };
  // What is typed, until it is saved (undefined = show the saved value).
  const [contextText, setContextText] = useState<string | undefined>(undefined);
  const contextInvalid = contextText !== undefined && parseContext(contextText) === null;
  const saveContext = () => {
    if (contextText === undefined) return;
    const n = parseContext(contextText);
    if (n === null) return; // the error stays visible, nothing is saved
    if (n !== settings?.maxContextTokens) update({ maxContextTokens: n });
    setContextText(undefined);
  };
  return (
    <Screen>
      {settings ? (
        <Card style={{ gap: 16 }}>
          <Text variant="subtitle">{t('settings.service')}</Text>
          <ToggleRow
            label={t('settings.startAtBoot')}
            hint={t('settings.startAtBootHint')}
            value={settings.startAtBoot}
            onChange={(startAtBoot) => update({ startAtBoot })}
          />
          <ToggleRow
            label={t('settings.connectOnStart')}
            hint={t('settings.connectOnStartHint')}
            value={settings.connectOnStart}
            onChange={(connectOnStart) => update({ connectOnStart })}
          />
        </Card>
      ) : null}
      <BatteryExemption alwaysShow />
      {settings ? (
        <Card style={{ gap: 16 }}>
          <ChoiceGroup<ComputeChoice>
            label={t('settings.compute.label')}
            value={settings.compute}
            onChange={(compute) => update({ compute })}
            choices={(['auto', 'cpu', 'gpu'] as const).map((c) => ({
              value: c,
              label: t(`settings.compute.${c}`),
            }))}
          />
          <Text variant="caption" muted>
            {t('settings.compute.hint')}
          </Text>
          <TextField
            label={t('settings.context.label')}
            value={
              contextText ??
              (settings.maxContextTokens > 0 ? String(settings.maxContextTokens) : '')
            }
            onChangeText={setContextText}
            // Saved when the field loses focus or is submitted: every change reloads the model on the device.
            onBlur={saveContext}
            onSubmitEditing={saveContext}
            keyboardType="number-pad"
            placeholder={t('settings.context.auto')}
            error={
              contextInvalid
                ? t('settings.context.invalid', { min: MIN_CONTEXT, max: MAX_CONTEXT })
                : undefined
            }
            hint={t('settings.context.hint')}
          />
        </Card>
      ) : null}
      <Card>
        <ChoiceGroup
          label={t('theme.label')}
          value={preference}
          onChange={setPreference}
          choices={THEME_PREFERENCES.map((p) => ({ value: p, label: t(`theme.${p}`) }))}
        />
      </Card>
      <Card>
        <ChoiceGroup<Language>
          label={t('language.label')}
          value={(i18n.resolvedLanguage as Language) ?? 'en'}
          onChange={setLanguage}
          choices={LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
        />
      </Card>
    </Screen>
  );
}
