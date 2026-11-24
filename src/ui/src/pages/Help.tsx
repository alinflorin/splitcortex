import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowRight24Regular,
  Box24Regular,
  Chat24Regular,
  Code24Regular,
  DataTrending24Regular,
  Document24Regular,
  Gauge24Regular,
  Globe24Regular,
  Key24Regular,
  People24Regular,
  Phone24Regular,
  Speaker224Regular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppDownloads } from '../components/AppDownloads';
import { Endpoints } from '../components/Endpoints';
import { PageHeader } from '../components/layout/PageHeader';
import {
  CardGrid,
  CodeBlock,
  CtaBand,
  GlassStage,
  ctaStyle,
  DividedList,
  FeatureCard,
  Section,
} from '../components/marketing/marketing';
import { LiquidGlass } from '../components/marketing/LiquidGlass';
import { buildKeyExamples, getGatewayBaseUrl } from '../lib/gateway';
import { useLocalePath } from '../seo/useLocalePath';

const SECTIONS = [
  'start',
  'devices',
  'models',
  'api',
  'access',
  'monitor',
  'troubleshoot',
] as const;

const useStyles = makeStyles({
  toc: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  tocList: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  tocLink: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    textDecorationLine: 'none',
    ':hover': {
      color: tokens.colorBrandForeground1,
      backgroundColor: tokens.colorBrandBackground2,
    },
  },
  banner: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXL,
  },
  bannerText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  muted: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase400 },
  subhead: { marginTop: tokens.spacingVerticalM },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
    lineHeight: tokens.lineHeightBase400,
  },
});

interface Entry {
  title: string;
  body: string;
}

/** The end-user help page: how to set up an organisation, devices, models, keys and the API, and what to do when something fails. */
export function Help() {
  const styles = useStyles();
  const { t } = useTranslation();
  const localePath = useLocalePath();
  const entries = (key: string) => t(key, { returnObjects: true }) as Entry[];
  const list = (key: string) => t(key, { returnObjects: true }) as string[];
  const example = buildKeyExamples(getGatewayBaseUrl(), 'sc_…').curl;

  const devices = [
    { key: 'mobile', icon: <Phone24Regular /> },
    { key: 'cli', icon: <Code24Regular /> },
    { key: 'web', icon: <Globe24Regular /> },
  ] as const;
  const models = [
    { key: 'pool', icon: <Box24Regular /> },
    { key: 'kind', icon: <Document24Regular /> },
    { key: 'media', icon: <Speaker224Regular /> },
    { key: 'context', icon: <Gauge24Regular /> },
  ] as const;
  const access = [
    { key: 'keys', icon: <Key24Regular /> },
    { key: 'limits', icon: <Gauge24Regular /> },
    { key: 'roles', icon: <People24Regular /> },
  ] as const;
  const monitor = [
    { key: 'playground', icon: <Chat24Regular /> },
    { key: 'usage', icon: <DataTrending24Regular /> },
    { key: 'metrics', icon: <DataTrending24Regular /> },
    { key: 'benchmarks', icon: <Gauge24Regular /> },
    { key: 'audit', icon: <Document24Regular /> },
  ] as const;

  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />

      <nav className={styles.toc} aria-label={t('help.toc')}>
        <Text size={200} weight="semibold">
          {t('help.toc')}
        </Text>
        <div className={styles.tocList}>
          {SECTIONS.map((id) => (
            <a key={id} href={`#${id}`} className={styles.tocLink}>
              {t(`help.sections.${id}`)}
            </a>
          ))}
        </div>
      </nav>

      <GlassStage>
        <LiquidGlass radius={28} bezel={20}>
          <aside id="start" className={styles.banner}>
            <div className={styles.bannerText}>
              <Text weight="semibold" size={500}>
                {t('help.quickstart.title')}
              </Text>
              <Text className={styles.muted}>{t('help.quickstart.body')}</Text>
            </div>
            <Link to={localePath('/quick-start')}>
              <Button
                appearance="primary"
                style={ctaStyle}
                icon={<ArrowRight24Regular />}
                iconPosition="after"
              >
                {t('help.quickstart.button')}
              </Button>
            </Link>
          </aside>
        </LiquidGlass>
      </GlassStage>

      <Section id="devices" title={t('help.devices.title')} subtitle={t('help.devices.subtitle')}>
        <CardGrid>
          {devices.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`help.devices.items.${key}.title`)}
              body={t(`help.devices.items.${key}.body`)}
            />
          ))}
        </CardGrid>
        <Text weight="semibold" size={500} className={styles.subhead}>
          {t('help.devices.enrollTitle')}
        </Text>
        <DividedList numbered items={entries('help.devices.enroll')} />
        <Text weight="semibold" size={500} className={styles.subhead}>
          {t('help.devices.downloadsTitle')}
        </Text>
        <AppDownloads bare />
      </Section>

      <Section id="models" title={t('help.models.title')} subtitle={t('help.models.subtitle')}>
        <CardGrid>
          {models.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`help.models.items.${key}.title`)}
              body={t(`help.models.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section id="api" title={t('help.api.title')} subtitle={t('help.api.subtitle')}>
        <Endpoints bare />
        <Text weight="semibold" size={500}>
          {t('help.api.curlTitle')}
        </Text>
        <CodeBlock code={example} />
        <Text className={styles.muted}>{t('help.api.modelHint')}</Text>
        <Text weight="semibold" size={500}>
          {t('help.api.supportedTitle')}
        </Text>
        <ul className={styles.list}>
          {list('help.api.supported').map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <Text className={styles.muted}>{t('help.api.balancing')}</Text>
      </Section>

      <Section id="access" title={t('help.access.title')} subtitle={t('help.access.subtitle')}>
        <CardGrid>
          {access.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`help.access.items.${key}.title`)}
              body={t(`help.access.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section id="monitor" title={t('help.monitor.title')} subtitle={t('help.monitor.subtitle')}>
        <CardGrid>
          {monitor.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`help.monitor.items.${key}.title`)}
              body={t(`help.monitor.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section
        id="troubleshoot"
        title={t('help.troubleshoot.title')}
        subtitle={t('help.troubleshoot.subtitle')}
      >
        <DividedList items={entries('help.troubleshoot.items')} />
      </Section>

      <CtaBand title={t('help.cta.title')} body={t('help.cta.body')}>
        <Link to={localePath('/contact')}>
          <Button
            size="large"
            appearance="secondary"
            icon={<ArrowRight24Regular />}
            iconPosition="after"
          >
            {t('help.cta.button')}
          </Button>
        </Link>
      </CtaBand>
    </>
  );
}
