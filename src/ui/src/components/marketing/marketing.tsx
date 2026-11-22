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
    gap: tokens.spacingVerticalXL,
    marginTop: '72px',
    scrollMarginTop: '88px',
    '@media (max-width: 599px)': { marginTop: '48px' },
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    maxWidth: '680px',
  },
  headCenter: { alignItems: 'center', textAlign: 'center', marginInline: 'auto' },
  eyebrow: {
    color: tokens.colorBrandForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: tokens.fontWeightSemibold,
  },
  title: {
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
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase500,
  },
  gradientText: {
    color: BRAND_FROM,
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXL,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    transitionProperty: 'transform, border-color, background-color',
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    ':hover': {
      transform: 'translateY(-3px)',
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
    },
  },
  iconTile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    marginBottom: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusLarge,
    color: '#fff',
    backgroundColor: BRAND_FROM,
  },
  cardBody: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase300 },
  grid: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
  },
  code: {
    position: 'relative',
    margin: 0,
    padding: tokens.spacingVerticalL,
    paddingRight: '56px',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
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
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  band: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    marginTop: '72px',
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalXXL}`,
    borderRadius: '28px',
    color: '#fff',
    backgroundColor: BRAND_FROM,
    '@media (max-width: 599px)': { marginTop: '48px', padding: tokens.spacingVerticalXXL },
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
  eyebrow,
  title,
  subtitle,
  center,
  children,
}: {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  center?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <section id={id} className={styles.section}>
      <div className={mergeClasses(styles.head, center && styles.headCenter)}>
        {eyebrow && (
          <Text size={200} className={styles.eyebrow}>
            {eyebrow}
          </Text>
        )}
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>
      {children}
    </section>
  );
}

export function GradientText({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <span className={styles.gradientText}>{children}</span>;
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
