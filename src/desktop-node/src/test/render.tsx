import { FluentProvider, teamsLightTheme } from '@fluentui/react-components';
import { render } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/translation.json';

export { en };

/** Renders with English translations and Fluent (no network). */
export async function renderApp(ui: ReactElement) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <FluentProvider theme={teamsLightTheme}>{ui}</FluentProvider>
    </I18nextProvider>,
  );
}
