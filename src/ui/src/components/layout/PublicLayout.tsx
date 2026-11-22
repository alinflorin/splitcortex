import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Navigation24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { UserMenu } from './UserMenu';

const useStyles = makeStyles({
  root: { minHeight: '100dvh', backgroundColor: tokens.colorNeutralBackground1 },
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 80%, transparent)`,
    backdropFilter: 'saturate(1.4) blur(12px)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  barInner: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    height: '64px',
    maxWidth: '1120px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalXXXL}`,
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
  links: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    '@media (max-width: 599px)': { display: 'none' },
  },
  link: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    textDecorationLine: 'none',
    fontSize: tokens.fontSizeBase300,
    ':hover': { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  linkActive: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  spacer: { flexGrow: 1 },
  openApp: { '@media (max-width: 599px)': { display: 'none' } },
  burger: { display: 'none', '@media (max-width: 599px)': { display: 'inline-flex' } },
  main: {
    maxWidth: '1120px',
    margin: '0 auto',
    boxSizing: 'border-box',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXXL}`,
    '@media (max-width: 599px)': {
      padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}`,
    },
  },
});

/** Public pages (Home, About, Contact, Terms, Privacy): a top header, no sidebar. */
export function PublicLayout() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();

  const links = [
    { to: '/', key: 'home', end: true },
    { to: '/about', key: 'about', end: false },
    { to: '/contact', key: 'contact', end: false },
  ] as const;

  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link to="/" className={styles.brandLink} aria-label="SplitCortex">
            <img src="/logo.svg" alt="" className={styles.logo} />
            <Text className={styles.brand}>
              <span className={styles.brandSplit}>split</span>
              <span className={styles.brandCortex}>cortex</span>
            </Text>
          </Link>
          <nav className={styles.links} aria-label={t('nav.public')}>
            {links.map(({ to, key, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  mergeClasses(styles.link, isActive && styles.linkActive)
                }
              >
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
          <div className={styles.spacer} />
          {user && (
            <Button
              appearance="primary"
              className={styles.openApp}
              onClick={() => void navigate('/organisations')}
            >
              {t('nav.openApp')}
            </Button>
          )}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                shape="circular"
                className={styles.burger}
                icon={<Navigation24Regular />}
                aria-label={t('nav.toggle')}
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {links.map(({ to, key }) => (
                  <MenuItem key={to} onClick={() => void navigate(to)}>
                    {t(`nav.${key}`)}
                  </MenuItem>
                ))}
                {user && (
                  <MenuItem onClick={() => void navigate('/organisations')}>
                    {t('nav.openApp')}
                  </MenuItem>
                )}
              </MenuList>
            </MenuPopover>
          </Menu>
          <UserMenu />
        </div>
      </header>
      <main className={styles.main}>
        <div key={pathname} className="sc-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
