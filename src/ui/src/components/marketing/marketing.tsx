import { Button, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Copy20Regular } from '@fluentui/react-icons';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND, BRAND_GRADIENT, BRAND_GRADIENT_MINT, BRAND_SHADOW } from '../../theme/brand';
import { useToast } from '../feedback/useToast';
import { LiquidGlass } from './LiquidGlass';

export const BRAND_FROM: string = BRAND.violet;
export const BRAND_TO: string = BRAND.mint;

/** Pill-shaped call-to-action buttons with a soft brand glow; spread onto a primary `Button`. */
export const ctaStyle: CSSProperties = {
  borderRadius: '999px',
  boxShadow: BRAND_SHADOW,
  paddingInline: '28px',
};

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXXL,
    marginTop: '120px',
    scrollMarginTop: '88px',
    '@media (max-width: 599px)': { marginTop: '72px' },
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    maxWidth: '720px',
  },
  headCenter: { alignItems: 'center', textAlign: 'center', marginInline: 'auto' },
  title: {
    margin: 0,
    fontSize: '44px',
    lineHeight: '48px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.035em',
    '@media (max-width: 599px)': { fontSize: '30px', lineHeight: '34px' },
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase500,
  },
  gradientText: {
    backgroundImage: BRAND_GRADIENT,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  },
  // Flat feature: a gradient icon tile (the logo's colours), a title and a paragraph on the page itself.
  card: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  iconTile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    marginBottom: tokens.spacingVerticalS,
    borderRadius: '16px',
    color: '#fff',
    backgroundImage: BRAND_GRADIENT,
    boxShadow: BRAND_SHADOW,
  },
  iconTileMint: {
    backgroundImage: BRAND_GRADIENT_MINT,
    boxShadow: `0 10px 28px rgba(20, 184, 212, 0.3)`,
  },
  cardBody: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase400 },
  grid: {
    display: 'grid',
    columnGap: tokens.spacingHorizontalXXXL,
    rowGap: tokens.spacingVerticalXXXL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  },
  // Bento: a stage of soft colour blobs with a few glass tiles over it.
  stage: { position: 'relative', isolation: 'isolate' },
  blob: {
    position: 'absolute',
    zIndex: -1,
    borderRadius: '50%',
    filter: 'blur(70px)',
    pointerEvents: 'none',
  },
  blobA: {
    width: '420px',
    height: '420px',
    top: '-60px',
    left: '8%',
    backgroundColor: BRAND.violet,
    opacity: 0.38,
  },
  blobB: {
    width: '360px',
    height: '360px',
    bottom: '-40px',
    right: '10%',
    backgroundColor: BRAND.mint,
    opacity: 0.3,
  },
  blobC: {
    width: '300px',
    height: '300px',
    top: '35%',
    right: '40%',
    backgroundColor: BRAND.cyan,
    opacity: 0.26,
  },
  bento: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    '@media (max-width: 899px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    '@media (max-width: 599px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: '32px',
    minHeight: '220px',
    gridColumn: 'span 2',
    '@media (max-width: 899px)': { gridColumn: 'span 1', padding: '24px' },
  },
  tileWide: { gridColumn: 'span 3', '@media (max-width: 899px)': { gridColumn: 'span 2' } },
  tileFull: {
    '@media (max-width: 899px)': { gridColumn: 'span 2' },
    '@media (max-width: 599px)': { gridColumn: 'span 1' },
  },
  code: {
    margin: 0,
    padding: tokens.spacingVerticalL,
    paddingRight: '56px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  codeFrame: {
    position: 'relative',
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: '20px',
    backgroundColor: tokens.colorNeutralBackground3,
    boxShadow: 'inset 0 0 0 1px rgba(127, 127, 127, 0.18)',
  },
  codeBar: {
    display: 'flex',
    gap: '6px',
    padding: '12px 16px 0',
  },
  codeDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: tokens.colorNeutralStroke1,
  },
  copy: { position: 'absolute', top: tokens.spacingVerticalS, right: tokens.spacingHorizontalS },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    boxShadow: 'inset 0 0 0 1px rgba(127, 127, 127, 0.16)',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  band: {
    position: 'relative',
    isolation: 'isolate',
    overflow: 'hidden',
    marginTop: '120px',
    padding: '80px 32px',
    borderRadius: '40px',
    color: '#fff',
    backgroundImage: BRAND_GRADIENT,
    '@media (max-width: 599px)': { marginTop: '72px', padding: '40px 16px', borderRadius: '28px' },
  },
  bandBlobA: {
    position: 'absolute',
    zIndex: -1,
    width: '380px',
    height: '380px',
    top: '-120px',
    left: '-60px',
    borderRadius: '50%',
    backgroundColor: BRAND.mint,
    opacity: 0.55,
    filter: 'blur(60px)',
  },
  bandBlobB: {
    position: 'absolute',
    zIndex: -1,
    width: '320px',
    height: '320px',
    bottom: '-140px',
    right: '-40px',
    borderRadius: '50%',
    backgroundColor: BRAND.violetLight,
    opacity: 0.6,
    filter: 'blur(60px)',
  },
  bandGlass: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    maxWidth: '760px',
    marginInline: 'auto',
    padding: '48px 40px',
    '@media (max-width: 599px)': { padding: '32px 20px' },
  },
  bandTitle: {
    margin: 0,
    fontSize: '40px',
    lineHeight: '44px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.035em',
    '@media (max-width: 599px)': { fontSize: '28px', lineHeight: '32px' },
  },
  bandBody: { maxWidth: '560px', opacity: 0.94, fontSize: tokens.fontSizeBase400 },
  bandActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    justifyContent: 'center',
    marginTop: tokens.spacingVerticalS,
  },
  rows: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
    columnGap: tokens.spacingHorizontalXXXL,
    rowGap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalXL} 0`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    '@media (max-width: 799px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  rowTitle: { display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'baseline' },
  rowIndex: { color: tokens.colorBrandForeground1, fontVariantNumeric: 'tabular-nums' },
});

/** A landing-page section: heading block (left or centred), then content. */
export function Section({
  id,
  title,
  subtitle,
  center,
  children,
}: {
  id?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  center?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <section id={id} className={styles.section}>
      <div className={mergeClasses(styles.head, center && styles.headCenter)}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>
      {children}
    </section>
  );
}

/** Text filled with the brand gradient. */
export function GradientText({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <span className={styles.gradientText}>{children}</span>;
}

/** A gradient icon tile (violet or mint), a title and a short paragraph. */
export function FeatureCard({
  icon,
  title,
  body,
  mint,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  mint?: boolean;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <article className={styles.card}>
      <span className={mergeClasses(styles.iconTile, mint && styles.iconTileMint)}>{icon}</span>
      <Text weight="semibold" size={400}>
        {title}
      </Text>
      <Text className={styles.cardBody}>{body}</Text>
      {children}
    </article>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.grid}>{children}</div>;
}

/** Soft colour blobs behind glass: the glass has something to bend. */
export function GlassStage({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.stage}>
      <span className={mergeClasses(styles.blob, styles.blobA)} aria-hidden="true" />
      <span className={mergeClasses(styles.blob, styles.blobB)} aria-hidden="true" />
      <span className={mergeClasses(styles.blob, styles.blobC)} aria-hidden="true" />
      {children}
    </div>
  );
}

/** A bento grid of glass tiles (6 columns on desktop, 2 on tablets, 1 on phones). Put it in a `GlassStage`. */
export function Bento({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.bento}>{children}</div>;
}

export function BentoTile({
  icon,
  title,
  body,
  size = 'third',
  mint,
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  /** `third` = 2 of 6 columns, `half` = 3, `full` = all 6. */
  size?: 'third' | 'half' | 'full';
  mint?: boolean;
}) {
  const styles = useStyles();
  return (
    <LiquidGlass
      radius={28}
      bezel={22}
      className={mergeClasses(
        styles.tile,
        size === 'half' && styles.tileWide,
        size === 'full' && styles.tileFull,
      )}
      style={size === 'full' ? { gridColumn: '1 / -1' } : undefined}
    >
      <span className={mergeClasses(styles.iconTile, mint && styles.iconTileMint)}>{icon}</span>
      <Text weight="semibold" size={500}>
        {title}
      </Text>
      <Text className={styles.cardBody}>{body}</Text>
    </LiquidGlass>
  );
}

export function Chips({ items }: { items: string[] }) {
  const styles = useStyles();
  return (
    <div className={styles.chips}>
      {items.map((item) => (
        <span key={item} className={styles.chip}>
          {item}
        </span>
      ))}
    </div>
  );
}

/** A monospace snippet in a small window with a copy button. */
export function CodeBlock({ code }: { code: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t('apps.cli.copied'));
    } catch {
      toast.error(t('apps.cli.copyFailed'));
    }
  };
  return (
    <div className={styles.codeFrame}>
      <div className={styles.codeBar} aria-hidden="true">
        <span className={styles.codeDot} />
        <span className={styles.codeDot} />
        <span className={styles.codeDot} />
      </div>
      <pre className={styles.code}>
        <code>{code}</code>
      </pre>
      <Button
        className={styles.copy}
        appearance="subtle"
        icon={<Copy20Regular />}
        aria-label={t('apps.cli.copy')}
        onClick={() => void copy()}
      />
    </div>
  );
}

/** A full-width call to action: brand gradient with colour blobs and the text on a glass panel. */
export function CtaBand({
  title,
  body,
  children,
}: {
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <section className={styles.band}>
      <span className={styles.bandBlobA} aria-hidden="true" />
      <span className={styles.bandBlobB} aria-hidden="true" />
      <LiquidGlass radius={32} bezel={20} className={styles.bandGlass}>
        <h2 className={styles.bandTitle}>{title}</h2>
        <Text className={styles.bandBody}>{body}</Text>
        <div className={styles.bandActions}>{children}</div>
      </LiquidGlass>
    </section>
  );
}

/** Title left, text right, hairlines between: the way to list FAQs, steps and clauses. */
export function DividedList({
  items,
  numbered,
}: {
  items: { title: ReactNode; body: ReactNode }[];
  numbered?: boolean;
}) {
  const styles = useStyles();
  return (
    <ol className={styles.rows}>
      {items.map((item, i) => (
        <li key={i} className={styles.row}>
          <div className={styles.rowTitle}>
            {numbered && <Text className={styles.rowIndex}>{String(i + 1).padStart(2, '0')}</Text>}
            <Text weight="semibold" size={400}>
              {item.title}
            </Text>
          </div>
          <Text className={styles.cardBody}>{item.body}</Text>
        </li>
      ))}
    </ol>
  );
}
