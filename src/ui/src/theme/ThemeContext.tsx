import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FluentProvider, teamsDarkTheme, teamsLightTheme } from '@fluentui/react-components';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'sc-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode: setModeState,
      toggle: () => setModeState((m) => (m === 'light' ? 'dark' : 'light')),
    }),
    [mode],
  );

  return (
    <ThemeContext value={value}>
      <FluentProvider theme={mode === 'dark' ? teamsDarkTheme : teamsLightTheme} style={{ minHeight: '100dvh' }}>
        {children}
      </FluentProvider>
    </ThemeContext>
  );
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used inside <ThemeProvider>');
  return ctx;
}
