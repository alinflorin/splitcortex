import { FluentProvider, teamsLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import en from '../../public/locales/en/translation.json';
import { NotFound } from './NotFound';

describe('NotFound', () => {
  it('renders the message and a link home', async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <FluentProvider theme={teamsLightTheme}>
          <MemoryRouter>
            <NotFound />
          </MemoryRouter>
        </FluentProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText(en.notFound.title)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });
});
