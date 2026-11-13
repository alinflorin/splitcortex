import {
  Avatar,
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Person24Regular, Settings24Regular, SignOut24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../../auth/useCurrentUser';

const useStyles = makeStyles({
  trigger: { minWidth: 'auto', padding: tokens.spacingHorizontalXS, borderRadius: tokens.borderRadiusCircular },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    minWidth: '240px',
  },
  headerText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export function UserMenu() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const user = useCurrentUser();

  if (!user) {
    return (
      <Button
        appearance="primary"
        shape="circular"
        icon={<Person24Regular />}
        disabled={auth.isLoading}
        onClick={() => void auth.signinRedirect({ state: { returnTo: window.location.pathname } })}
      >
        {t('auth.signIn')}
      </Button>
    );
  }

  return (
    <Menu positioning={{ align: 'end' }}>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" className={styles.trigger} aria-label={t('auth.account')}>
          <Avatar name={user.name} color="colorful" size={32} />
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <div className={styles.header}>
          <Avatar name={user.name} color="colorful" size={48} />
          <div className={styles.headerText}>
            <Text weight="semibold" className={styles.ellipsis}>
              {user.name}
            </Text>
            {user.email && (
              <Text size={200} className={styles.ellipsis} style={{ color: tokens.colorNeutralForeground3 }}>
                {user.email}
              </Text>
            )}
          </div>
        </div>
        <MenuDivider />
        <MenuList>
          <MenuItem icon={<Settings24Regular />} onClick={() => void navigate('/settings')}>
            {t('nav.settings')}
          </MenuItem>
          {/* Dex has no end_session_endpoint: drop the local session only. */}
          <MenuItem icon={<SignOut24Regular />} onClick={() => void auth.removeUser().then(() => navigate('/'))}>
            {t('auth.signOut')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
