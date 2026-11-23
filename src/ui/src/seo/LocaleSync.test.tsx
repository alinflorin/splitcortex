import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import en from '../../public/locales/en/translation.json';
import ro from '../../public/locales/ro/translation.json';
import { LocaleSync } from './LocaleSync';

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

async function setup(lng: 'en' | 'ro', route: string) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng,
    resources: { en: { translation: en }, ro: { translation: ro } },
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <LocaleSync />
        <Where />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return i18n;
}

const where = () => screen.getByTestId('where').textContent;

describe('LocaleSync', () => {
  it('sends a Romanian reader of a bare public URL to the Romanian page', async () => {
    await setup('ro', '/about');
    expect(where()).toBe('/ro/about');
  });

  it('leaves a matching URL alone', async () => {
    await setup('en', '/about');
    expect(where()).toBe('/about');
    await setup('ro', '/ro/privacy');
    expect(screen.getAllByTestId('where').map((e) => e.textContent)).toContain('/ro/privacy');
  });

  it('does not touch the signed-in app', async () => {
    await setup('ro', '/organisations');
    expect(where()).toBe('/organisations');
  });

  it('does not move the return from the identity provider', async () => {
    await setup('ro', '/?code=abc&state=xyz');
    expect(where()).toBe('/?code=abc&state=xyz');
  });

  it('follows a language switch to the same page in the other language', async () => {
    const i18n = await setup('en', '/contact');
    await act(() => i18n.changeLanguage('ro'));
    expect(where()).toBe('/ro/contact');
    await act(() => i18n.changeLanguage('en'));
    expect(where()).toBe('/contact');
  });
});
