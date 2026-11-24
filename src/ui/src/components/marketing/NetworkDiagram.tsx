import { Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  Code24Regular,
  Desktop24Regular,
  Globe24Regular,
  Phone24Regular,
  Server24Regular,
} from '@fluentui/react-icons';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../../theme/brand';
import { GLASS } from '../../theme/glass';

/** Mint reads on top of violet glass in both themes; violet lines vanished into it. */
const LINE = BRAND.mint;

const useStyles = makeStyles({
  root: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    minHeight: '320px',
    padding: tokens.spacingVerticalL,
    borderRadius: 'inherit',
    overflow: 'hidden',
  },
  lines: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  col: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: '100%',
    minHeight: '280px',
    gap: tokens.spacingVerticalM,
  },
  center: { position: 'relative', display: 'flex', justifyContent: 'center' },
  tile: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    boxSizing: 'border-box',
    width: '96px',
    borderRadius: tokens.borderRadiusXLarge,
    ...GLASS.well,
    color: tokens.colorNeutralForeground1,
  },
  tileLabel: { fontSize: tokens.fontSizeBase100 },
  hub: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logo: {
    position: 'relative',
    width: '76px',
    height: '76px',
    padding: '14px',
    borderRadius: '24px',
    ...GLASS.panel,
    boxShadow: `${GLASS.panel.boxShadow}, 0 12px 32px -12px rgba(79, 93, 240, 0.55)`,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '76px',
    height: '76px',
    borderRadius: '24px',
    border: `2px solid ${BRAND.mint}`,
    animationName: 'sc-pulse',
    animationDuration: '2.8s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-out',
    pointerEvents: 'none',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorPaletteGreenForeground1,
    position: 'absolute',
    top: '8px',
    right: '8px',
  },
  // Out of the flow, so the logo (not logo + label) is what sits on the vertical centre the lines aim at.
  hubLabel: {
    position: 'absolute',
    top: '100%',
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
  },
});

function Tile({
  icon,
  label,
  live,
  node,
}: {
  icon: ReactNode;
  label: string;
  live?: boolean;
  node: 'device' | 'app';
}) {
  const styles = useStyles();
  return (
    <div className={styles.tile} data-node={node}>
      {live && <span className={styles.dot} />}
      {icon}
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}

interface Line {
  d: string;
}

/** Lines are measured from the real elements: they start at a card's edge and end at the hub's edge. */
function useLines(rootRef: React.RefObject<HTMLDivElement | null>): {
  lines: Line[];
  w: number;
  h: number;
} {
  const [state, setState] = useState<{ lines: Line[]; w: number; h: number }>({
    lines: [],
    w: 0,
    h: 0,
  });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const rel = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { l: r.left - box.left, r: r.right - box.left, y: r.top - box.top + r.height / 2 };
      };
      const hub = root.querySelector('[data-node="hub"]');
      const app = root.querySelector('[data-node="app"]');
      if (!hub || !app) return;
      const h = rel(hub);
      const lines: Line[] = [...root.querySelectorAll('[data-node="device"]')].map((el) => {
        const t = rel(el);
        const mid = (t.r + h.l) / 2;
        return { d: `M ${t.r} ${t.y} C ${mid} ${t.y}, ${mid} ${h.y}, ${h.l} ${h.y}` };
      });
      const a = rel(app);
      lines.push({ d: `M ${h.r} ${h.y} L ${a.l} ${a.y}` });
      setState({ lines, w: box.width, h: box.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef]);
  return state;
}

/** Hero illustration: devices connect out to the gateway, which serves your application. */
export function NetworkDiagram() {
  const styles = useStyles();
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const { lines, w, h } = useLines(rootRef);

  return (
    <div className={styles.root} ref={rootRef} aria-hidden="true">
      <svg className={styles.lines} viewBox={`0 0 ${w || 100} ${h || 100}`}>
        {lines.map((l) => (
          <path
            key={l.d}
            className="sc-motion"
            d={l.d}
            fill="none"
            stroke={LINE}
            strokeWidth="2.2"
            strokeDasharray="4 4"
            strokeLinecap="round"
            style={{ animation: 'sc-flow 1.2s linear infinite' }}
          />
        ))}
      </svg>
      <div className={styles.col}>
        <Tile node="device" icon={<Phone24Regular />} label={t('home.hero.phone')} live />
        <Tile node="device" icon={<Desktop24Regular />} label={t('home.hero.laptop')} live />
        <Tile node="device" icon={<Server24Regular />} label={t('home.hero.pi')} live />
        <Tile node="device" icon={<Globe24Regular />} label={t('home.hero.browser')} live />
      </div>
      <div className={styles.center}>
        <div className={styles.hub}>
          <div className={styles.logo} data-node="hub">
            <span className={`${styles.ring} sc-motion`} />
            <img src="/logo.svg" alt="" width={48} height={48} />
          </div>
          <Text size={200} weight="semibold" className={styles.hubLabel}>
            {t('home.hero.gateway')}
          </Text>
        </div>
      </div>
      <div className={styles.col}>
        <Tile node="app" icon={<Code24Regular />} label={t('home.hero.yourApp')} />
      </div>
    </div>
  );
}
