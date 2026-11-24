import type { MouseEvent, ReactElement } from 'react';
import { NavItem, Tooltip, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  // Inactive items are flat (no fill); only hover and the selected page get a background.
  item: {
    backgroundColor: 'transparent',
    // Tints of the text/brand colour on the glass sidebar, never a solid block.
    ':hover': {
      backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
    },
    '&[aria-current="page"]': {
      backgroundColor: `color-mix(in srgb, ${tokens.colorBrandBackground} 26%, transparent)`,
    },
    // Centre the icon on the label's line (the icon slot otherwise sits on the text baseline).
    // A grid, not flex: bundleIcon renders the Filled and Regular SVGs together and they must
    // overlap, otherwise the selected item's icon slot doubles in width and the label jumps right.
    alignItems: 'center',
    '& .fui-NavItem__icon': {
      display: 'grid',
      alignItems: 'center',
      lineHeight: 0,
      '& > svg': { gridArea: '1 / 1' },
    },
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
