import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowRight24Regular,
  Code24Regular,
  Eye24Regular,
  Document24Regular,
  Globe24Regular,
  Key24Regular,
  LockClosed24Regular,
  Mail24Regular,
  PlugDisconnected24Regular,
  People24Regular,
  Phone24Regular,
  ShieldCheckmark24Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useChartVersion } from '../lib/useChartVersion';
import { useLocalePath } from '../seo/useLocalePath';
import { CardGrid, CtaBand, FeatureCard, Section } from '../components/marketing/marketing';

const useStyles = makeStyles({
  hero: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalXXL,
  },
  h1: {
    margin: 0,
    maxWidth: '820px',
    fontSize: '60px',
    lineHeight: '64px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.04em',
    '@media (max-width: 599px)': { fontSize: '36px', lineHeight: '40px' },
  },
  lead: {
    maxWidth: '640px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    marginTop: tokens.spacingVerticalXXL,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL} 0 0`,
  },
  statValue: {
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.03em',
  },
  muted: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase400 },
  story: {
    display: 'grid',
    columnGap: tokens.spacingHorizontalXXXL,
    rowGap: tokens.spacingVerticalXXL,
    gridTemplateColumns: '1fr 1fr',
    '@media (max-width: 799px)': { gridTemplateColumns: '1fr' },
  },
  storyCol: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  flow: {
    display: 'grid',
    alignItems: 'stretch',
    gap: tokens.spacingHorizontalS,
    gridTemplateColumns: '1fr auto 1fr auto 1fr',
    '@media (max-width: 899px)': { gridTemplateColumns: '1fr' },
  },
  flowBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXL,
    borderRadius: '20px',
  },
  // The gateway is the one filled panel: it is the part every request passes through.
  flowBoxHub: { backgroundColor: tokens.colorBrandBackground2 },
  flowArrow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalXXS,
    minWidth: '112px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
    '@media (max-width: 899px)': {
      flexDirection: 'row',
      justifyContent: 'center',
      padding: tokens.spacingVerticalXS,
    },
  },
  flowArrowLine: {
    width: '100%',
    height: '2px',
    backgroundImage: `repeating-linear-gradient(90deg, ${tokens.colorBrandForeground1} 0 6px, transparent 6px 12px)`,
    '@media (max-width: 899px)': {
      width: '2px',
      height: '24px',
      backgroundImage: `repeating-linear-gradient(180deg, ${tokens.colorBrandForeground1} 0 6px, transparent 6px 12px)`,
    },
  },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    color: tokens.colorNeutralForeground2,
  },
  legalLinks: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0 },
  legalLink: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalL} 0`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: 'inherit',
    textDecorationLine: 'none',
    ':hover': { color: tokens.colorBrandForeground1 },
  },
  legalText: { display: 'flex', flexDirection: 'column', flexGrow: 1 },
});

function FlowBox({
  title,
  body,
  children,
  hub,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  hub?: boolean;
}) {
  const styles = useStyles();
  return (
    <div className={`${styles.flowBox} ${hub ? styles.flowBoxHub : ''}`}>
      <Text weight="semibold" size={500}>
        {title}
      </Text>
      <Text className={styles.muted}>{body}</Text>
      {children}
    </div>
  );
}

function FlowArrow({ label, sub }: { label: string; sub: string }) {
  const styles = useStyles();
  return (
    <div className={styles.flowArrow} aria-hidden="true">
      <Text size={200} weight="semibold">
        {label}
      </Text>
      <span className={styles.flowArrowLine} />
      <Text size={100}>{sub}</Text>
    </div>
  );
}

export function About() {
  const styles = useStyles();
  const { t } = useTranslation();
  const version = useChartVersion();
  const localePath = useLocalePath();
  const list = (key: string) => t(key, { returnObjects: true }) as string[];

  const principles = [
    { key: 'byod', icon: <People24Regular /> },
    { key: 'outbound', icon: <PlugDisconnected24Regular /> },
    { key: 'identity', icon: <ShieldCheckmark24Regular /> },
    { key: 'keys', icon: <Key24Regular /> },
    { key: 'tenants', icon: <LockClosed24Regular /> },
    { key: 'privacy', icon: <Eye24Regular /> },
  ] as const;

  const nodes = [
    { key: 'mobile', icon: <Phone24Regular /> },
    { key: 'cli', icon: <Code24Regular /> },
    { key: 'web', icon: <Globe24Regular /> },
  ] as const;

  const legal = [
    { to: '/terms', key: 'legal.terms', icon: <Document24Regular /> },
    { to: '/privacy', key: 'legal.privacy', icon: <LockClosed24Regular /> },
    { to: '/contact', key: 'contact', icon: <Mail24Regular /> },
  ] as const;

  return (
    <>
      <section className={styles.hero}>
        {version && (
          <Text size={200} className={styles.muted}>
            {t('app.version', { version })}
          </Text>
        )}
        <h1 className={styles.h1}>
          {t('about.title')}: {t('about.hero.highlight')}
        </h1>
        <Text className={styles.lead}>{t('about.hero.lead')}</Text>
        <div className={styles.stats}>
          {(['nodes', 'inbound', 'api', 'engine'] as const).map((k) => (
            <div key={k} className={styles.stat}>
              <span className={styles.statValue}>{t(`about.stats.${k}.value`)}</span>
              <Text size={200} className={styles.muted}>
                {t(`about.stats.${k}.label`)}
              </Text>
            </div>
          ))}
        </div>
      </section>

      <Section title={t('about.story.title')}>
        <div className={styles.story}>
          <div className={styles.storyCol}>
            <Text weight="semibold" size={500}>
              {t('about.story.problemTitle')}
            </Text>
            <Text className={styles.muted}>{t('about.story.problem')}</Text>
          </div>
          <div className={styles.storyCol}>
            <Text weight="semibold" size={500}>
              {t('about.story.answerTitle')}
            </Text>
            <Text className={styles.muted}>{t('about.story.answer')}</Text>
          </div>
        </div>
      </Section>

      <Section title={t('about.flow.title')} subtitle={t('about.flow.subtitle')}>
        <div className={styles.flow}>
          <FlowBox title={t('about.flow.client.title')} body={t('about.flow.client.body')} />
          <FlowArrow label={t('about.flow.leg1')} sub={t('about.flow.leg1Sub')} />
          <FlowBox hub title={t('about.flow.gateway.title')} body={t('about.flow.gateway.body')}>
            <ol className={styles.list}>
              {list('about.flow.gateway.steps').map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </FlowBox>
          <FlowArrow label={t('about.flow.leg2')} sub={t('about.flow.leg2Sub')} />
          <FlowBox title={t('about.flow.node.title')} body={t('about.flow.node.body')} />
        </div>
      </Section>

      <Section title={t('about.principles.title')} subtitle={t('about.principles.subtitle')}>
        <CardGrid>
          {principles.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`about.principles.items.${key}.title`)}
              body={t(`about.principles.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section title={t('about.nodes.title')} subtitle={t('about.nodes.subtitle')}>
        <CardGrid>
          {nodes.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`about.nodes.items.${key}.title`)}
              body={t(`about.nodes.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section title={t('legal.linksTitle')} subtitle={t('legal.linksSubtitle')}>
        <div className={styles.legalLinks}>
          {legal.map(({ to, key, icon }) => (
            <Link key={to} to={localePath(to)} className={styles.legalLink}>
              {icon}
              <span className={styles.legalText}>
                <Text weight="semibold">{t(`${key}.title`)}</Text>
                <Text className={styles.muted}>{t(`${key}.subtitle`)}</Text>
              </span>
              <ArrowRight24Regular />
            </Link>
          ))}
        </div>
      </Section>

      <CtaBand title={t('about.cta.title')} body={t('about.cta.body')}>
        <Link to="/organisations">
          <Button
            size="large"
            appearance="secondary"
            icon={<ArrowRight24Regular />}
            iconPosition="after"
          >
            {t('about.cta.button')}
          </Button>
        </Link>
      </CtaBand>
    </>
  );
}
