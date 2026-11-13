import { Button, Tooltip } from '@fluentui/react-components';
import { WeatherMoon24Regular, WeatherSunny24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useThemeMode } from '../../theme/ThemeContext';

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { mode, toggle } = useThemeMode();
  const label = mode === 'light' ? t('theme.switchToDark') : t('theme.switchToLight');

  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        shape="circular"
        icon={mode === 'light' ? <WeatherMoon24Regular /> : <WeatherSunny24Regular />}
        onClick={toggle}
      />
    </Tooltip>
  );
}
