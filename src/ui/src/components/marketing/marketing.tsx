import { Button, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Copy20Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../../theme/brand';
import { useToast } from '../feedback/useToast';

export const BRAND_FROM: string = BRAND.violet;
export const BRAND_TO: string = BRAND.mint;

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXXL,
    marginTop: '112px',
    scrollMarginTop: '88px',
    '@media (max-width: 599px)': { marginTop: '64px' },
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    maxWidth: '720px',
  },
  headCenter: { alignItems: 'center', textAlign: 'center', marginInline: 'auto' },
  title: {
    margin: 0,
    fontSize: '40px',
    lineHeight: '44px',
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.03em',
    '@media (max-width: 599px)': {
      fontSize: tokens.fontSizeBase600,
      lineHeight: tokens.lineHeightBase600,
    },
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase500,
  },
  // Flat: an icon, a title and a paragraph on the page itself. No box, no border.
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  iconTile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    marginBottom: tokens.spacingVerticalS,
    borderRadius: '14px',
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  cardBody: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase300 },
  grid: {
    display: 'grid',
    columnGap: tokens.spacingHorizontalXXXL,
    rowGap: tokens.spacingVerticalXXXL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  },
  code: {
    position: 'relative',
    margin: 0,
    padding: tokens.spacingVerticalL,
    paddingRight: '56px',
    borderRadius: '16px',
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  copy: { position: 'absolute', top: tokens.spacingVerticalS, right: tokens.spacingHorizontalS },
  codeWrap: { position: 'relative', minWidth: 0, maxWidth: '100%' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  band: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    marginTop: '112px',
    padding: '72px 32px',
    borderRadius: '32px',
    color: '#fff',
    backgroundColor: BRAND_FROM,
    '@media (max-width: 599px)': { marginTop: '64px', padding: '48px 20px', borderRadius: '24px' },
  },
  bandTitle: {
    margin: 0,
    fontSize: tokens.fontSizeHero700,
    lineHeight: tokens.lineHeightHero700,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '-0.02em',
    '@media (max-width: 599px)': {
      fontSize: tokens.fontSizeBase600,
      lineHeight: tokens.lineHeightBase600,
    },
  },
  bandBody: { maxWidth: '560px', opacity: 0.92, fontSize: tokens.fontSizeBase400 },
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
  rowIndex: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  bandActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    justifyContent: 'center',
  },
});

/** A landing-page section: centred or left-aligned heading block, then content. */
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

/** An icon tile, a title and a short paragraph. */
export function FeatureCard({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <article className={styles.card}>
      <span className={styles.iconTile}>{icon}</span>
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

/** A monospace snippet with a copy button. */
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
    <div className={styles.codeWrap}>
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

/** A full-width call to action. */
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
      <h2 className={styles.bandTitle}>{title}</h2>
      <Text className={styles.bandBody}>{body}</Text>
      <div className={styles.bandActions}>{children}</div>
    </section>
  );
}

/** Title left, text right, hairlines between: the borderless way to list FAQs, steps and clauses. */
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
