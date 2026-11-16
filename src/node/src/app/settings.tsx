import { useTranslation } from 'react-i18next';
import { Card } from '../components/Card';
import { ChoiceGroup } from '../components/ChoiceGroup';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { ToggleRow } from '../components/ToggleRow';
import { LANGUAGES, setLanguage, type Language } from '../i18n';
import { runtime } from '../runtime';
import {
  CONTEXT_CHOICES,
  computePrefs,
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
          <ChoiceGroup
            label={t('settings.context.label')}
            value={String(settings.maxContextTokens)}
            onChange={(v) => update({ maxContextTokens: Number(v) })}
            choices={CONTEXT_CHOICES.map((c) => ({
              value: String(c),
              label: c === 0 ? t('settings.context.auto') : `${c}`,
            }))}
          />
          <Text variant="caption" muted>
            {t('settings.context.hint')}
          </Text>
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
