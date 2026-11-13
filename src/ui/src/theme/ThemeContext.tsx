import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FluentProvider, teamsDarkTheme, teamsLightTheme } from '@fluentui/react-components';
import { useMediaQuery } from '../lib/useMediaQuery';

// Same typeface on every OS: Inter is self-hosted (src/fonts.css); the rest is a system fallback.
const FONT_FAMILY = "'Inter Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif";
const lightTheme = { ...teamsLightTheme, fontFamilyBase: FONT_FAMILY };
const darkTheme = { ...teamsDarkTheme, fontFamilyBase: FONT_FAMILY };

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

interface ThemeContextValue {
  /** What the user chose; `system` follows the OS and is the default. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** The theme actually applied. */
  mode: ThemeMode;
}

const STORAGE_KEY = 'sc-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo<ThemeContextValue>(() => ({ preference, setPreference, mode }), [preference, mode]);

  return (
    <ThemeContext value={value}>
      <FluentProvider theme={mode === 'dark' ? darkTheme : lightTheme} style={{ minHeight: '100dvh' }}>
        {children}
      </FluentProvider>
    </ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
