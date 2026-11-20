import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowRight24Regular,
  Code24Regular,
  Eye24Regular,
  Globe24Regular,
  Key24Regular,
  LockClosed24Regular,
  PlugDisconnected24Regular,
  People24Regular,
  Phone24Regular,
  ShieldCheckmark24Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  BRAND_FROM,
  BRAND_TO,
  CardGrid,
  CtaBand,
  FeatureCard,
  GradientText,
  Section,
} from '../components/marketing/marketing';

const useStyles = makeStyles({
  hero: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    padding: '64px 56px',
    borderRadius: '32px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 599px)': { padding: '32px 20px', borderRadius: '24px' },
  },
  eyebrow: {
    color: tokens.colorBrandForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: tokens.fontWeightSemibold,
  },
  h1: {
    margin: 0,
    maxWidth: '760px',
    fontSize: '52px',
    lineHeight: '56px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.035em',
    '@media (max-width: 599px)': { fontSize: '34px', lineHeight: '38px' },
  },
  lead: {
    maxWidth: '640px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
  stats: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    marginTop: tokens.spacingVerticalL,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
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
    gap: tokens.spacingHorizontalXL,
    gridTemplateColumns: '1fr 1fr',
    '@media (max-width: 799px)': { gridTemplateColumns: '1fr' },
  },
  storyCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXL,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  storyAccent: { borderTop: `3px solid ${BRAND_FROM}` },
  storyAccent2: { borderTop: `3px solid ${BRAND_TO}` },
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
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  flowBoxHub: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
  },
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
    backgroundImage: `repeating-linear-gradient(90deg, ${BRAND_FROM} 0 6px, transparent 6px 12px)`,
    '@media (max-width: 899px)': {
      width: '2px',
      height: '24px',
      backgroundImage: `repeating-linear-gradient(180deg, ${BRAND_FROM} 0 6px, transparent 6px 12px)`,
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
  nodeChip: { alignSelf: 'flex-start' },
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

  return (
    <>
      <section className={styles.hero}>
        <Text size={200} className={styles.eyebrow}>
          {t('about.hero.eyebrow')}
        </Text>
        <h1 className={styles.h1}>
          {t('about.title')}: <GradientText>{t('about.hero.highlight')}</GradientText>
        </h1>
        <Text className={styles.lead}>{t('about.hero.lead')}</Text>
        <div className={styles.stats}>
          {(['nodes', 'inbound', 'api', 'engine'] as const).map((k) => (
            <div key={k} className={styles.stat}>
              <span className={styles.statValue}>
                <GradientText>{t(`about.stats.${k}.value`)}</GradientText>
              </span>
              <Text size={200} className={styles.muted}>
                {t(`about.stats.${k}.label`)}
              </Text>
            </div>
          ))}
        </div>
      </section>

      <Section eyebrow={t('about.story.eyebrow')} title={t('about.story.title')}>
        <div className={styles.story}>
          <div className={`${styles.storyCard} ${styles.storyAccent}`}>
            <Text weight="semibold" size={500}>
              {t('about.story.problemTitle')}
            </Text>
            <Text className={styles.muted}>{t('about.story.problem')}</Text>
          </div>
          <div className={`${styles.storyCard} ${styles.storyAccent2}`}>
            <Text weight="semibold" size={500}>
              {t('about.story.answerTitle')}
            </Text>
            <Text className={styles.muted}>{t('about.story.answer')}</Text>
          </div>
        </div>
      </Section>

      <Section
        eyebrow={t('about.flow.eyebrow')}
        title={t('about.flow.title')}
        subtitle={t('about.flow.subtitle')}
      >
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

      <Section
        eyebrow={t('about.principles.eyebrow')}
        title={t('about.principles.title')}
        subtitle={t('about.principles.subtitle')}
      >
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

      <Section
        eyebrow={t('about.nodes.eyebrow')}
        title={t('about.nodes.title')}
        subtitle={t('about.nodes.subtitle')}
      >
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
