import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import './fonts.css';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext';

// i18next loads translation JSON from /locales; suspend until ready.
createRoot(document.getElementById('root')!).render(
  <Suspense fallback={null}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </Suspense>,
);
