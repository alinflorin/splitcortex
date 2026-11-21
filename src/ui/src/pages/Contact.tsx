import { Mail24Regular, Location24Regular, Clock24Regular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { CardGrid, FeatureCard } from '../components/marketing/marketing';

/** Placeholder contact details until real ones exist. */
export function Contact() {
  const { t } = useTranslation();
  const items = [
    { key: 'email', icon: <Mail24Regular /> },
    { key: 'address', icon: <Location24Regular /> },
    { key: 'hours', icon: <Clock24Regular /> },
  ] as const;
  return (
    <>
      <PageHeader
        eyebrow={t('contact.eyebrow')}
        title={t('contact.title')}
        subtitle={t('contact.subtitle')}
      />
      <CardGrid>
        {items.map(({ key, icon }) => (
          <FeatureCard
            key={key}
            icon={icon}
            title={t(`contact.${key}.title`)}
            body={t(`contact.${key}.body`)}
          />
        ))}
      </CardGrid>
    </>
  );
}
