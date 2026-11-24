import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowRight24Regular,
  Bot24Regular,
  Chat24Regular,
  Code24Regular,
  Flash24Regular,
  Key24Regular,
  Link24Regular,
  PuzzlePiece24Regular,
  Window24Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppDownloads } from '../components/AppDownloads';
import { Endpoints } from '../components/Endpoints';
import { PageHeader } from '../components/layout/PageHeader';
import {
  CardGrid,
  Chips,
  CodeBlock,
  CtaBand,
  DividedList,
  FeatureCard,
  Section,
} from '../components/marketing/marketing';
import { buildKeyExamples, getGatewayBaseUrl } from '../lib/gateway';
import { BRAND_GRADIENT, BRAND_SHADOW } from '../theme/brand';
import { useLocalePath } from '../seo/useLocalePath';
import { GLASS } from '../theme/glass';

const useStyles = makeStyles({
  steps: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  step: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalXXL} 0`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    '@media (max-width: 599px)': { gridTemplateColumns: '1fr' },
  },
  stepNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundImage: BRAND_GRADIENT,
    boxShadow: BRAND_SHADOW,
    color: '#fff',
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  stepBody: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase400 },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
    lineHeight: tokens.lineHeightBase400,
  },
  extra: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    marginTop: tokens.spacingVerticalS,
  },
  need: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXL,
    borderRadius: '20px',
    ...GLASS.panel,
  },
  subhead: { marginTop: tokens.spacingVerticalM },
  note: { color: tokens.colorNeutralForeground3 },
  stepTitle: { margin: 0 },
});

interface Step {
  title: string;
  body: string;
  tips: string[];
}
interface Group {
  title: string;
  body: string;
  apps: string[];
}
interface Note {
  title: string;
  body: string;
}

/** The first-run walkthrough: from an empty account to a call to the OpenAI-compatible API, and what to plug it into. */
export function QuickStart() {
  const styles = useStyles();
  const { t } = useTranslation();
  const localePath = useLocalePath();
  const list = <T,>(key: string) => t(key, { returnObjects: true }) as T[];
  const examples = buildKeyExamples(getGatewayBaseUrl(), 'sc_…');

  const extras: Record<number, ReactNode> = {
    3: (
      <div className={styles.extra}>
        <Text weight="semibold">{t('quickstart.downloadsTitle')}</Text>
        <AppDownloads bare />
      </div>
    ),
    5: (
      <div className={styles.extra}>
        <Endpoints bare />
        <Text weight="semibold">{t('quickstart.examplesTitle')}</Text>
        <CodeBlock code={examples.curl} />
        <CodeBlock code={examples.python} />
      </div>
    ),
  };

  const fields = [
    { key: 'baseUrl', icon: <Link24Regular /> },
    { key: 'key', icon: <Key24Regular /> },
    { key: 'model', icon: <Flash24Regular /> },
  ] as const;
  const groups = [
    { key: 'chat', icon: <Chat24Regular /> },
    { key: 'coding', icon: <Code24Regular /> },
    { key: 'automation', icon: <PuzzlePiece24Regular /> },
    { key: 'sdk', icon: <Window24Regular /> },
  ] as const;
  const agents = ['build', 'works', 'limits'] as const;

  return (
    <>
      <PageHeader title={t('quickstart.title')} subtitle={t('quickstart.subtitle')} />

      <div className={styles.need}>
        <Text weight="semibold" size={400}>
          {t('quickstart.needTitle')}
        </Text>
        <ul className={styles.list}>
          {list<string>('quickstart.need').map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <Section id="steps" title={t('quickstart.stepsTitle')}>
        <ol className={styles.steps}>
          {list<Step>('quickstart.steps').map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span
                className={styles.stepNumber}
                aria-label={`${t('quickstart.stepWord')} ${i + 1}`}
              >
                {i + 1}
              </span>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>
                  <Text weight="semibold" size={500}>
                    {s.title}
                  </Text>
                </h3>
                <Text className={styles.muted}>{s.body}</Text>
                <ul className={styles.list}>
                  {s.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
                {extras[i]}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="software"
        title={t('quickstart.software.title')}
        subtitle={t('quickstart.software.subtitle')}
      >
        <CardGrid>
          {fields.map(({ key, icon }) => (
            <FeatureCard
              key={key}
              icon={icon}
              title={t(`quickstart.software.fields.${key}.title`)}
              body={t(`quickstart.software.fields.${key}.body`)}
            />
          ))}
        </CardGrid>
        <Text weight="semibold" size={500} className={styles.subhead}>
          {t('quickstart.software.groupsTitle')}
        </Text>
        <CardGrid>
          {groups.map(({ key, icon }) => {
            const group = t(`quickstart.software.groups.${key}`, { returnObjects: true }) as Group;
            return (
              <FeatureCard key={key} icon={icon} title={group.title} body={group.body}>
                <Chips items={group.apps} />
              </FeatureCard>
            );
          })}
        </CardGrid>
        <Text size={200} className={styles.note}>
          {t('quickstart.software.trademark')}
        </Text>
      </Section>

      <Section
        id="agents"
        title={t('quickstart.agents.title')}
        subtitle={t('quickstart.agents.subtitle')}
      >
        <CardGrid>
          {agents.map((key) => (
            <FeatureCard
              key={key}
              icon={<Bot24Regular />}
              title={t(`quickstart.agents.items.${key}.title`)}
              body={t(`quickstart.agents.items.${key}.body`)}
            />
          ))}
        </CardGrid>
      </Section>

      <Section id="notes" title={t('quickstart.notes.title')}>
        <DividedList items={list<Note>('quickstart.notes.items')} />
      </Section>

      <CtaBand title={t('quickstart.cta.title')} body={t('quickstart.cta.body')}>
        <Link to={localePath('/help')}>
          <Button
            size="large"
            appearance="secondary"
            icon={<ArrowRight24Regular />}
            iconPosition="after"
          >
            {t('quickstart.cta.help')}
          </Button>
        </Link>
        <Link to="/playground">
          <Button size="large" appearance="secondary">
            {t('quickstart.cta.playground')}
          </Button>
        </Link>
      </CtaBand>
    </>
  );
}
