import { Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiProvider } from './api/ApiProvider';
import { OidcProvider } from './auth/OidcProvider';
import { i18nReady } from './i18n';
import './fonts.css';
import './index.css';
import { FeedbackProvider } from './components/feedback/FeedbackProvider';
import { ThemeProvider } from './theme/ThemeContext';

// i18next loads translation JSON from /locales. The page is prerendered (see scripts/prerender.mjs): it stays on screen
// until the language is loaded and the app can take over in one go.
await i18nReady;

/** The app has taken over: reveal #root (index.html hides the prerendered page for dark-theme users until now). */
function Mounted() {
  useEffect(() => {
    document.getElementById('root')?.removeAttribute('data-prerendered');
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={null}>
    <Mounted />
    <ThemeProvider>
      <BrowserRouter>
        <OidcProvider>
          <FeedbackProvider>
            <ApiProvider>
              <App />
            </ApiProvider>
          </FeedbackProvider>
        </OidcProvider>
      </BrowserRouter>
    </ThemeProvider>
  </Suspense>,
);
