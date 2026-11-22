import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactElement, ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXL}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
  icon: { color: tokens.colorBrandForeground1, display: 'flex', fontSize: '32px' },
  text: { color: tokens.colorNeutralForeground2, maxWidth: '440px' },
});

/** A list with nothing in it yet: an icon, one sentence and (when the user may) the primary action. */
export function EmptyState({
  icon,
  text,
  actionLabel,
  actionIcon,
  onAction,
}: {
  icon: ReactNode;
  text: ReactNode;
  actionLabel?: string;
  actionIcon?: ReactElement;
  onAction?: () => void;
}) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <Text className={styles.text}>{text}</Text>
      {actionLabel && onAction && (
        <Button appearance="primary" icon={actionIcon} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
