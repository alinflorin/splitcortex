import { Button, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Tooltip } from '@fluentui/react-components';
import { LocalLanguage24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';

export function LanguageSwitcher() {
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
        <Tooltip content={t('language.label')} relationship="label">
          <Button appearance="subtle" shape="circular" icon={<LocalLanguage24Regular />}>
            {current.toUpperCase()}
          </Button>
        </Tooltip>
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
