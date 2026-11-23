// Server entry of the prerender (`vite build --ssr`, run by scripts/prerender.mjs at image build time): renders the public
// pages to HTML so crawlers and link previews get real content. There is no server at runtime and nothing is hydrated:
// the app replaces this HTML once it has loaded.
import {
  RendererProvider,
  SSRProvider,
  createDOMRenderer,
  renderToStyleElements,
} from '@fluentui/react-components';
import i18next from 'i18next';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import { StaticRouter } from 'react-router-dom';
import ro from '../public/locales/ro/translation.json';
import en from '../public/locales/en/translation.json';
import { App } from './App';
import { ApiProvider } from './api/ApiProvider';
import { FeedbackProvider } from './components/feedback/FeedbackProvider';
import type { Language } from './i18n/languages';
import { buildHead, renderHeadTags, renderTitle } from './seo/head';
import { PUBLIC_PAGES, localizedPath } from './seo/pages';
import { ThemeProvider } from './theme/ThemeContext';

const RESOURCES = { en, ro };

// Nobody is signed in while prerendering.
const signedOut = {
  isLoading: false,
  isAuthenticated: false,
  user: null,
} as unknown as AuthContextProps;

export interface Rendered {
  /** Contents of `<div id="root">`. */
  html: string;
  /** Griffel (Fluent) styles used by that HTML, as `<style>` elements. */
  styles: string;
  /** `<title>` and the SEO tags. */
  head: string;
}

async function instance(lng: Language) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: { [lng]: { translation: RESOURCES[lng] } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** The page at `pathname` (a public page in `lng`, or any other path for the app shell), as HTML. */
export async function render(pathname: string, lng: Language, origin: string): Promise<Rendered> {
  const i18n = await instance(lng);
  const renderer = createDOMRenderer();
  const html = renderToString(
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <I18nextProvider i18n={i18n}>
          <AuthContext.Provider value={signedOut}>
            <ThemeProvider>
              <StaticRouter location={pathname}>
                <FeedbackProvider>
                  <ApiProvider>
                    <App />
                  </ApiProvider>
                </FeedbackProvider>
              </StaticRouter>
            </ThemeProvider>
          </AuthContext.Provider>
        </I18nextProvider>
      </SSRProvider>
    </RendererProvider>,
  );
  const head = buildHead({ pathname, origin, t: (key) => i18n.t(key) });
  return {
    html,
    styles: renderToStaticMarkup(<>{renderToStyleElements(renderer)}</>),
    head: `${renderTitle(head)}\n    ${renderHeadTags(head)}`,
  };
}

/** The app shell (every signed-in page and unknown URLs): no content, `noindex`. */
export async function renderShell(origin: string): Promise<Pick<Rendered, 'head'>> {
  const i18n = await instance('en');
  const head = buildHead({ pathname: '/app', origin, t: (key) => i18n.t(key) });
  return { head: `${renderTitle(head)}\n    ${renderHeadTags(head)}` };
}

/** Every public URL (page x language) with its language, for the prerender and the sitemap. */
export function publicUrls(languages: readonly Language[]) {
  return languages.flatMap((lng) =>
    PUBLIC_PAGES.map((page) => ({ lng, page, path: localizedPath(page.path, lng) })),
  );
}
