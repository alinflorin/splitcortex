import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { OidcProvider } from './auth/OidcProvider';
import './i18n';
import './fonts.css';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext';

// i18next loads translation JSON from /locales; suspend until ready.
createRoot(document.getElementById('root')!).render(
  <Suspense fallback={null}>
    <ThemeProvider>
      <BrowserRouter>
        <OidcProvider>
          <App />
        </OidcProvider>
      </BrowserRouter>
    </ThemeProvider>
  </Suspense>,
);
