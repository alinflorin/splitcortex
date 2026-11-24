import { Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXL,
  },
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
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
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
