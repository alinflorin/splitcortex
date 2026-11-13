import { Menu, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components';
import { LocalLanguage24Regular, PaintBrush24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../../theme/ThemeContext';

function isThemePreference(value: string | undefined): value is ThemePreference {
  return THEME_PREFERENCES.some((p) => p === value);
}

/** Theme submenu (System / Light / Dark). Render inside a <MenuList>. */
export function ThemeSubmenu() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  return (
    <Menu
      checkedValues={{ theme: [preference] }}
      onCheckedValueChange={(_, data) => {
        const next = data.checkedItems[0];
        if (isThemePreference(next)) setPreference(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuItem icon={<PaintBrush24Regular />}>{t('theme.label')}</MenuItem>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {THEME_PREFERENCES.map((p) => (
            <MenuItemRadio key={p} name="theme" value={p}>
              {t(`theme.${p}`)}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** Language submenu. The detected language (browser, else English) is pre-selected. Render inside a <MenuList>. */
export function LanguageSubmenu() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <Menu
      checkedValues={{ language: [current] }}
      onCheckedValueChange={(_, data) => {
        const next = data.checkedItems[0];
        if (next) void i18n.changeLanguage(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuItem icon={<LocalLanguage24Regular />}>{t('language.label')}</MenuItem>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {SUPPORTED_LANGUAGES.map((lng) => (
            <MenuItemRadio key={lng} name="language" value={lng}>
              {t(`language.${lng}`)}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
