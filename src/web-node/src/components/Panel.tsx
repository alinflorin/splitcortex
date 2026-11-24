import { Card, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { GLASS } from '../theme/glass';

const useStyles = makeStyles({
  card: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: '16px',
    ...GLASS.panel,
    padding: tokens.spacingVerticalL,
    gap: tokens.spacingVerticalM,
  },
  head: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  title: { flex: '1 1 auto', overflowWrap: 'anywhere' },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** The one card layout of the app: filled surface, no border or shadow, a title and optional side content. */
export function Panel({
  title,
  side,
  children,
}: {
  title: ReactNode;
  side?: ReactNode;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <Text weight="semibold" size={400} className={styles.title}>
          {title}
        </Text>
        {side}
      </div>
      {children}
    </Card>
  );
}

const useStat = makeStyles({
  stats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}`,
  },
  stat: { display: 'flex', flexDirection: 'column', minWidth: '96px', maxWidth: '100%' },
  label: { color: tokens.colorNeutralForeground3 },
  value: { overflowWrap: 'anywhere' },
});

export function StatRow({ children }: { children: ReactNode }) {
  return <div className={useStat().stats}>{children}</div>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  const styles = useStat();
  return (
    <div className={styles.stat}>
      <Text size={200} className={styles.label}>
        {label}
      </Text>
      <Text weight="semibold" className={styles.value}>
        {value}
      </Text>
    </div>
  );
}
