import {
  Button,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Navigation24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router-dom';
import { BRAND } from '../../theme/brand';
import { GLOBAL_ITEMS } from './globalNav';
import { UserMenu } from './UserMenu';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    height: '64px',
    flexShrink: 0,
    padding: `0 ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 599px)': {
      padding: `0 ${tokens.spacingHorizontalM}`,
      gap: tokens.spacingHorizontalS,
    },
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
  // The wordmark carries the logo's two gradients: violet, mint → cyan.
  brandSplit: {
    backgroundImage: `linear-gradient(180deg, ${BRAND.violetLight}, ${BRAND.violet})`,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
  },
  brandCortex: {
    backgroundImage: `linear-gradient(180deg, ${BRAND.mint}, ${BRAND.cyan})`,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
  },
  links: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    '@media (max-width: 1023px)': { display: 'none' },
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
});

/** The same bar on every page: brand (home), the top-level links, the account menu. */
export function TopBar({
  showNavToggle,
  onToggleNav,
}: {
  /** Narrow screens: the links move into the drawer this button opens. */
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
      <Link to="/" className={styles.brandLink} aria-label="SplitCortex">
        <img src="/logo.svg" alt="" className={styles.logo} />
        <Text className={styles.brand}>
          <span className={styles.brandSplit}>split</span>
          <span className={styles.brandCortex}>cortex</span>
        </Text>
      </Link>
      <nav className={styles.links} aria-label={t('nav.main')}>
        {GLOBAL_ITEMS.map(({ to, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => mergeClasses(styles.link, isActive && styles.linkActive)}
          >
            {t(`nav.${key}`)}
          </NavLink>
        ))}
      </nav>
      <div className={styles.spacer} />
      <UserMenu />
    </header>
  );
}
