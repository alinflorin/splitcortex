import { Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  Code24Regular,
  Desktop24Regular,
  Globe24Regular,
  Phone24Regular,
  Server24Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../../theme/brand';

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
    backgroundColor: `color-mix(in srgb, ${tokens.colorNeutralBackground1} 82%, transparent)`,
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.18)',
    color: tokens.colorNeutralForeground1,
  },
  tileLabel: { fontSize: tokens.fontSizeBase100 },
  hub: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalXS,
  },
  logo: {
    position: 'relative',
    width: '76px',
    height: '76px',
    padding: '14px',
    borderRadius: '24px',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: '0 12px 32px -12px rgba(79, 93, 240, 0.55)',
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
  hubLabel: { color: tokens.colorNeutralForeground2 },
});

function Tile({ icon, label, live }: { icon: ReactNode; label: string; live?: boolean }) {
  const styles = useStyles();
  return (
    <div className={styles.tile}>
      {live && <span className={styles.dot} />}
      {icon}
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}

/** Hero illustration: devices connect out to the gateway, which serves your application. */
export function NetworkDiagram() {
  const styles = useStyles();
  const { t } = useTranslation();
  const rows = [12.5, 37.5, 62.5, 87.5];

  return (
    <div className={styles.root} aria-hidden="true">
      <svg className={styles.lines} viewBox="0 0 100 100" preserveAspectRatio="none">
        {rows.map((y) => (
          <path
            key={y}
            className="sc-motion"
            d={`M 19 ${y} C 36 ${y}, 36 50, 50 50`}
            fill="none"
            stroke={LINE}
            strokeWidth="2.2"
            strokeDasharray="4 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ animation: 'sc-flow 1.2s linear infinite' }}
          />
        ))}
        <path
          className="sc-motion"
          d="M 50 50 L 81 50"
          fill="none"
          stroke={LINE}
          strokeWidth="2.2"
          strokeDasharray="4 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ animation: 'sc-flow 1.2s linear infinite' }}
        />
      </svg>
      <div className={styles.col}>
        <Tile icon={<Phone24Regular />} label={t('home.hero.phone')} live />
        <Tile icon={<Desktop24Regular />} label={t('home.hero.laptop')} live />
        <Tile icon={<Server24Regular />} label={t('home.hero.pi')} live />
        <Tile icon={<Globe24Regular />} label={t('home.hero.browser')} live />
      </div>
      <div className={styles.center}>
        <div className={styles.hub}>
          <div className={styles.logo}>
            <span className={`${styles.ring} sc-motion`} />
            <img src="/logo.svg" alt="" width={48} height={48} />
          </div>
          <Text size={200} weight="semibold" className={styles.hubLabel}>
            {t('home.hero.gateway')}
          </Text>
        </div>
      </div>
      <div className={styles.col}>
        <Tile icon={<Code24Regular />} label={t('home.hero.yourApp')} />
      </div>
    </div>
  );
}
