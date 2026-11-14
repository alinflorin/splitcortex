import { useTranslation } from 'react-i18next';
import { Card } from '../components/Card';
import { ChoiceGroup } from '../components/ChoiceGroup';
import { Screen } from '../components/Screen';
import { LANGUAGES, setLanguage, type Language } from '../i18n';
import { THEME_PREFERENCES, useTheme } from '../theme/ThemeContext';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  return (
    <Screen>
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
