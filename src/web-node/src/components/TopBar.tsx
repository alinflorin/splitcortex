import {
  Button,
  Menu,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Settings24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useChartVersion } from '../lib/useChartVersion';
import { LanguageSubmenu, ThemeSubmenu } from './PreferencesMenu';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '64px',
    padding: `0 ${tokens.spacingHorizontalXL}`,
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 80%, transparent)`,
    backdropFilter: 'saturate(1.4) blur(12px)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 599px)': { padding: `0 ${tokens.spacingHorizontalM}` },
  },
  brand: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0 },
  logo: { width: '32px', height: '32px', flexShrink: 0 },
  name: { fontSize: tokens.fontSizeBase400, textTransform: 'lowercase' },
  split: { color: '#14b8d4' },
  cortex: { color: '#4f5df0' },
  tag: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  spacer: { flexGrow: 1 },
});

export function TopBar() {
  const styles = useStyles();
  const { t } = useTranslation();
  const version = useChartVersion();
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <img className={styles.logo} src="/logo.svg" alt="" />
        <span className={styles.name}>
          <span className={styles.split}>split</span>
          <span className={styles.cortex}>cortex</span>
        </span>
        {version && <span className={styles.tag}>{t('app.version', { version })}</span>}
      </div>
      <div className={styles.spacer} />
      <Menu positioning={{ align: 'end' }}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            shape="circular"
            icon={<Settings24Regular />}
            aria-label={t('app.preferences')}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <ThemeSubmenu />
            <LanguageSubmenu />
          </MenuList>
        </MenuPopover>
      </Menu>
    </header>
  );
}
