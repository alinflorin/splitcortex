import type { MouseEvent, ReactElement } from 'react';
import { NavItem, Tooltip, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  // Inactive items are flat (no fill); only hover and the selected page get a background.
  item: {
    backgroundColor: 'transparent',
    ':hover': { backgroundColor: tokens.colorNeutralBackground2Hover },
    '&[aria-current="page"]': { backgroundColor: tokens.colorBrandBackground2 },
  },
});

interface NavEntryProps {
  to: string;
  label: string;
  icon: ReactElement;
  collapsed: boolean;
  onClick: (e: MouseEvent) => void;
}

/** One sidebar link. Collapsed: icon only, the label moves to a tooltip and the accessible name. */
export function NavEntry({ to, label, icon, collapsed, onClick }: NavEntryProps) {
  const styles = useStyles();
  const item = (
    <NavItem
      value={to}
      href={to}
      icon={icon}
      onClick={onClick}
      className={styles.item}
      aria-label={collapsed ? label : undefined}
    >
      {collapsed ? null : label}
    </NavItem>
  );
  return collapsed ? (
    <Tooltip content={label} relationship="description" positioning="after">
      {item}
    </Tooltip>
  ) : (
    item
  );
}
