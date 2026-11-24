import { Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: tokens.spacingVerticalM + ' ' + tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalXXXL,
  },
  text: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  eyebrow: {
    color: tokens.colorNeutralForeground3,
  },
  title: {
    margin: 0,
    fontSize: '36px',
    lineHeight: '40px',
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.03em',
    overflowWrap: 'anywhere',
    '@media (max-width: 599px)': {
      fontSize: tokens.fontSizeBase600,
      lineHeight: tokens.lineHeightBase600,
    },
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    maxWidth: '640px',
    textWrap: 'balance',
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
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
