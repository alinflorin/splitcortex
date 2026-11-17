import { Button, Text, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { Navigation24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { UserMenu } from './UserMenu';

const useStyles = makeStyles({
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '64px',
    flexShrink: 0,
    padding: `0 ${tokens.spacingHorizontalXL}`,
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 80%, transparent)`,
    backdropFilter: 'saturate(1.4) blur(12px)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 599px)': { padding: `0 ${tokens.spacingHorizontalM}` },
  },
  brandLink: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    textDecorationLine: 'none',
    minWidth: 0,
  },
  logo: { width: '32px', height: '32px', flexShrink: 0 },
  brand: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightRegular,
    textTransform: 'lowercase',
  },
  brandSplit: { color: '#14b8d4' },
  brandCortex: { color: '#4f5df0' },
  spacer: { flexGrow: 1 },
});

export function TopBar({
  showNavToggle,
  onToggleNav,
}: {
  showNavToggle: boolean;
  onToggleNav: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <header className={styles.bar}>
      {showNavToggle && (
        <Tooltip content={t('nav.toggle')} relationship="label">
          <Button
            appearance="subtle"
            shape="circular"
            icon={<Navigation24Regular />}
            onClick={onToggleNav}
          />
        </Tooltip>
      )}
      {showNavToggle && (
        <Link to="/" className={styles.brandLink} aria-label="SplitCortex">
          <img src="/logo.svg" alt="" className={styles.logo} />
          <Text className={styles.brand}>
            <span className={styles.brandSplit}>split</span>
            <span className={styles.brandCortex}>cortex</span>
          </Text>
        </Link>
      )}
      <div className={styles.spacer} />
      <UserMenu />
    </header>
  );
}
