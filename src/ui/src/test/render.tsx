import { FluentProvider, teamsLightTheme } from '@fluentui/react-components';
import { render } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import en from '../../public/locales/en/translation.json';

export { en };

/** Renders with English translations, Fluent and a memory router (no network, no Dex). */
export async function renderApp(ui: ReactElement, route = '/') {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <FluentProvider theme={teamsLightTheme}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </FluentProvider>
    </I18nextProvider>,
  );
}
