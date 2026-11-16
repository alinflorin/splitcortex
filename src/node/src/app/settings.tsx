import { useTranslation } from 'react-i18next';
import { Card } from '../components/Card';
import { ChoiceGroup } from '../components/ChoiceGroup';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { ToggleRow } from '../components/ToggleRow';
import { LANGUAGES, setLanguage, type Language } from '../i18n';
import { useNodeSettings } from '../runtime/settings';
import { THEME_PREFERENCES, useTheme } from '../theme/ThemeContext';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  const { settings, update } = useNodeSettings();
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
