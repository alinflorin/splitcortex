import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowRight20Regular,
  BrainCircuit24Regular,
  Chat24Regular,
  DataTrending24Regular,
  Gauge24Regular,
  LockClosed24Regular,
  PhoneLaptop24Regular,
  PlugConnected24Regular,
} from '@fluentui/react-icons';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { AppDownloads } from '../components/AppDownloads';
import { Endpoints } from '../components/Endpoints';
import {
  BRAND_FROM,
  CardGrid,
  Chips,
  CodeBlock,
  CtaBand,
  FeatureCard,
  GradientText,
  Section,
} from '../components/marketing/marketing';
import { NetworkDiagram } from '../components/marketing/NetworkDiagram';
import { useCurrentUser } from '../auth/useCurrentUser';
import { buildKeyExamples, getGatewayBaseUrl } from '../lib/gateway';

const useStyles = makeStyles({
  hero: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1.1fr 1fr',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXXXL,
    padding: '56px',
    borderRadius: '32px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr', padding: '40px 28px' },
    '@media (max-width: 599px)': { padding: '28px 20px', borderRadius: '24px' },
  },
  heroText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  welcome: { color: tokens.colorNeutralForeground3 },
  pill: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  pillDot: {
    width: '8px',
    height: '8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: BRAND_FROM,
  },
  h1: {
    margin: 0,
    fontSize: '56px',
    lineHeight: '60px',
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.035em',
    '@media (max-width: 1000px)': { fontSize: '44px', lineHeight: '48px' },
    '@media (max-width: 599px)': { fontSize: '34px', lineHeight: '38px' },
  },
  lead: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    maxWidth: '520px',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  trust: { marginTop: tokens.spacingVerticalXXL },
  steps: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    counterReset: 'step',
  },
  step: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  stepNum: {
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.03em',
  },
  muted: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase300 },
  split: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: tokens.spacingHorizontalXXL,
    alignItems: 'center',
    '@media (max-width: 899px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  splitText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  play: { alignSelf: 'flex-start' },
});

export function Home() {
  const styles = useStyles();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const auth = useAuth();
  const navigate = useNavigate();
  const signedIn = !!user;
  const signIn = () => void auth.signinRedirect();

  // the page renders after load, so the browser cannot scroll to `/#run` itself
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const features = [
    { key: 'pools', icon: <BrainCircuit24Regular /> },
    { key: 'enroll', icon: <PhoneLaptop24Regular /> },
    { key: 'api', icon: <PlugConnected24Regular /> },
    { key: 'security', icon: <LockClosed24Regular /> },
    { key: 'limits', icon: <Gauge24Regular /> },
    { key: 'insights', icon: <DataTrending24Regular /> },
  ] as const;

  const example = buildKeyExamples(getGatewayBaseUrl(), 'sk-…').curl;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          {user && <Text className={styles.welcome}>{t('home.welcome', { name: user.name })}</Text>}
          <span className={styles.pill}>
            <span className={styles.pillDot} />
            {t('home.hero.badge')}
          </span>
          <h1 className={styles.h1}>
            {t('home.hero.titleA')} <GradientText>{t('home.hero.titleB')}</GradientText>
          </h1>
          <Text className={styles.lead}>{t('home.subtitle')}</Text>
          <div className={styles.actions}>
            {signedIn ? (
              <Button
                appearance="primary"
                size="large"
                icon={<ArrowRight20Regular />}
                iconPosition="after"
                onClick={() => void navigate('/organisations')}
              >
                {t('home.hero.ctaOrgs')}
              </Button>
            ) : (
              <Button
                appearance="primary"
                size="large"
                icon={<ArrowRight20Regular />}
                iconPosition="after"
                onClick={signIn}
              >
                {t('home.hero.ctaStart')}
              </Button>
            )}
            <Button as="a" href="#how" size="large">
              {t('home.hero.ctaHow')}
            </Button>
          </div>
        </div>
        <NetworkDiagram />
      </section>

      <div className={styles.trust}>
        <Chips items={t('home.trust', { returnObjects: true }) as string[]} />
      </div>

      <Section
        id="how"
        eyebrow={t('home.how.eyebrow')}
        title={t('home.how.title')}
        subtitle={t('home.how.subtitle')}
      >
        <div className={styles.steps}>
          {(['one', 'two', 'three'] as const).map((k, i) => (
            <div key={k} className={styles.step}>
              <span className={styles.stepNum}>
                <GradientText>{`0${i + 1}`}</GradientText>
              </span>
              <Text weight="semibold" size={500}>
                {t(`home.how.steps.${k}.title`)}
              </Text>
              <Text className={styles.muted}>{t(`home.how.steps.${k}.body`)}</Text>
            </div>
          ))}
        </div>
      </Section>

      <Section
        eyebrow={t('home.features.eyebrow')}
        title={t('home.features.title')}
        subtitle={t('home.features.subtitle')}
      >
        <CardGrid>
          {features.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`home.features.items.${key}.title`)}
              body={t(`home.features.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section title={t('home.code.title')} subtitle={t('home.code.body')}>
        <div className={styles.split}>
          <CodeBlock code={example} />
          <div className={styles.splitText}>
            <Text weight="semibold" size={500}>
              {t('playground.homeTitle')}
            </Text>
            <Text className={styles.muted}>{t('playground.homeBody')}</Text>
            {signedIn ? (
              <Button
                className={styles.play}
                as="a"
                href="/playground"
                target="_blank"
                rel="noopener"
                appearance="primary"
                icon={<Chat24Regular />}
              >
                {t('playground.open')}
              </Button>
            ) : (
              <Button
                className={styles.play}
                appearance="primary"
                icon={<Chat24Regular />}
                onClick={signIn}
              >
                {t('playground.open')}
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section
        id="run"
        eyebrow={t('home.run.eyebrow')}
        title={t('home.run.title')}
        subtitle={t('home.run.subtitle')}
      >
        <AppDownloads bare />
      </Section>

      <Section title={t('endpoints.title')} subtitle={t('endpoints.body')}>
        <Endpoints bare />
      </Section>

      <CtaBand title={t('home.cta.title')} body={t('home.cta.body')}>
        {signedIn ? (
          <Button
            size="large"
            appearance="secondary"
            onClick={() => void navigate('/organisations')}
          >
            {t('home.hero.ctaOrgs')}
          </Button>
        ) : (
          <Button size="large" appearance="secondary" onClick={signIn}>
            {t('home.hero.ctaStart')}
          </Button>
        )}
        <Link to="/about">
          <Button size="large" appearance="transparent" style={{ color: '#fff' }}>
            {t('home.cta.about')}
          </Button>
        </Link>
      </CtaBand>
    </>
  );
}
