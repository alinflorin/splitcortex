import { Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
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
});

/** The page heading of the web app (eyebrow, title, subtitle), so the node looks like it. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <header className={styles.root}>
      {eyebrow && (
        <Text size={200} className={styles.eyebrow}>
          {eyebrow}
        </Text>
      )}
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
    </header>
  );
}
