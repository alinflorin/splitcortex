import type { GriffelStyle } from '@fluentui/react-components';
import { tokens } from '@fluentui/react-components';

/**
 * The one glass recipe of the app. Every surface uses one of these, so nothing is a solid box:
 * - `panel`: cards, banners, bars (a frosted tint, a light sheen, a lit rim);
 * - `well`: things set into a surface (code, addresses, chips): clearer than a panel, same material.
 * Overlays (dialogs, menus, ...) and controls (inputs, buttons) get the same look from index.css.
 */
const BLUR = 'blur(16px) saturate(160%)';
const SHEEN = 'linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02) 55%)';
const RIM = 'inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.1)';
/** An outer hairline in the text colour, so glass keeps an edge on a light page too. */
const EDGE = `0 0 0 1px color-mix(in srgb, ${tokens.colorNeutralForeground1} 8%, transparent)`;

export const GLASS = {
  panel: {
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 50%, transparent)`,
    backgroundImage: SHEEN,
    backdropFilter: BLUR,
    WebkitBackdropFilter: BLUR,
    border: 'none',
    boxShadow: `${EDGE}, ${RIM}, 0 12px 32px -18px rgba(0, 0, 0, 0.4)`,
  },
  well: {
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 32%, transparent)`,
    backgroundImage: SHEEN,
    backdropFilter: 'blur(10px) saturate(150%)',
    WebkitBackdropFilter: 'blur(10px) saturate(150%)',
    border: 'none',
    boxShadow: `${EDGE}, ${RIM}`,
  },
} satisfies Record<string, GriffelStyle>;
