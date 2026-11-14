import { Card, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  // Mobile first: one column. Wider screens flow cards into several columns (`grid` variant) or keep one (`list`).
  list: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    '@media (min-width: 720px)': {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: tokens.spacingHorizontalL,
    },
  },
  card: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'none',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalL,
  },
  main: { display: 'flex', flexDirection: 'column', flex: '1 1 200px', minWidth: 0 },
  title: { overflowWrap: 'anywhere' },
  subtitle: { color: tokens.colorNeutralForeground3, overflowWrap: 'anywhere' },
  side: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  stats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalXXL,
  },
  stat: { display: 'flex', flexDirection: 'column', minWidth: '88px' },
  statLabel: { color: tokens.colorNeutralForeground3 },
});

/** Vertical stack of cards on mobile; `variant="grid"` flows into columns from tablet width up. */
export function CardList({
  variant = 'list',
  children,
}: {
  variant?: 'list' | 'grid';
  children: ReactNode;
}) {
  const styles = useStyles();
  return <div className={styles[variant]}>{children}</div>;
}

interface ItemCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Badges, a role picker, stats... shown beside the title (wraps below it on narrow screens). */
  meta?: ReactNode;
  /** Buttons; clicks here never trigger `onClick`. */
  actions?: ReactNode;
  /** Makes the whole card a link-like target. */
  onClick?: () => void;
  children?: ReactNode;
}

/** The one list-item layout used across the app: title block, side content, actions, optional body. */
export function ItemCard({ title, subtitle, meta, actions, onClick, children }: ItemCardProps) {
  const styles = useStyles();
  return (
    <Card className={styles.card} onClick={onClick}>
      <div className={styles.row}>
        <div className={styles.main}>
          <Text weight="semibold" className={styles.title}>
            {title}
          </Text>
          {subtitle && (
            <Text size={200} className={styles.subtitle}>
              {subtitle}
            </Text>
          )}
        </div>
        {meta && <div className={styles.side}>{meta}</div>}
        {actions && (
          <div className={styles.side} onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {children}
    </Card>
  );
}

/** A labelled number, e.g. "Requests 1,204". */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.stat}>
      <Text size={200} className={styles.statLabel}>
        {label}
      </Text>
      <Text weight="semibold">{value}</Text>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={mergeClasses(styles.stats)}>{children}</div>;
}
