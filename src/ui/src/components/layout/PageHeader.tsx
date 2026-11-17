import { Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  text: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, minWidth: 0 },
  eyebrow: {
    color: tokens.colorBrandForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: tokens.fontWeightSemibold,
  },
  title: {
    margin: 0,
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.02em',
    overflowWrap: 'anywhere',
    '@media (max-width: 599px)': {
      fontSize: tokens.fontSizeBase600,
      lineHeight: tokens.lineHeightBase600,
    },
  },
  subtitle: { color: tokens.colorNeutralForeground3, maxWidth: '640px' },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
});

/** The one page heading used across the app: optional eyebrow, title, subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <header className={styles.root}>
      <div className={styles.text}>
        {eyebrow && (
          <Text size={200} className={styles.eyebrow}>
            {eyebrow}
          </Text>
        )}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
