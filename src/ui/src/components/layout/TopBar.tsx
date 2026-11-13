import { Button, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { Navigation24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
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
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 599px)': { padding: `0 ${tokens.spacingHorizontalM}` },
  },
  spacer: { flexGrow: 1 },
});

export function TopBar({ showNavToggle, onToggleNav }: { showNavToggle: boolean; onToggleNav: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <header className={styles.bar}>
      {showNavToggle && (
        <Tooltip content={t('nav.toggle')} relationship="label">
          <Button appearance="subtle" shape="circular" icon={<Navigation24Regular />} onClick={onToggleNav} />
        </Tooltip>
      )}
      <div className={styles.spacer} />
      <UserMenu />
    </header>
  );
}
