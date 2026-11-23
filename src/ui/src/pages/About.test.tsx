import { FluentProvider, teamsLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../public/locales/en/translation.json';
import { About } from './About';

describe('About', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the story, the request flow and the principles', async () => {
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
            <About />
          </MemoryRouter>
        </FluentProvider>
      </I18nextProvider>,
    );

    expect(screen.getByText(en.about.hero.lead)).toBeInTheDocument();
    expect(screen.getByText(en.about.flow.title)).toBeInTheDocument();
    expect(screen.getByText(en.about.principles.items.outbound.title)).toBeInTheDocument();
    expect(screen.getByText(en.about.flow.gateway.steps[0] ?? '')).toBeInTheDocument();
  });

  it('shows the deployed version at the top', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: '1.2.3' }))),
    );
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
            <About />
          </MemoryRouter>
        </FluentProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByText(/1\.2\.3/)).toBeInTheDocument();
  });
});
