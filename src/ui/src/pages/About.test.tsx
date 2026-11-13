import { FluentProvider, teamsLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import en from '../../public/locales/en/translation.json';
import { About } from './About';

describe('About', () => {
  it('renders the translated title and paragraphs', async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <FluentProvider theme={teamsLightTheme}>
          <About />
        </FluentProvider>
      </I18nextProvider>,
    );

    expect(screen.getByText(en.about.title)).toBeInTheDocument();
    expect(screen.getByText(en.about.p1)).toBeInTheDocument();
    expect(screen.getByText(en.about.p3)).toBeInTheDocument();
  });
});
