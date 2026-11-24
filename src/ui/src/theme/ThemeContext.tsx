import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FluentProvider,
  mergeClasses,
  teamsDarkTheme,
  teamsLightTheme,
} from '@fluentui/react-components';
import { setSharedCookie } from '../lib/sharedCookie';
import { useMediaQuery } from '../lib/useMediaQuery';
import { DARK_BRAND_TOKENS, LIGHT_BRAND_TOKENS } from './brand';

// Same typeface on every OS: Inter is self-hosted (src/fonts.css); the rest is a system fallback.
const FONT_FAMILY =
  "'Inter Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif";
const lightTheme = { ...teamsLightTheme, ...LIGHT_BRAND_TOKENS, fontFamilyBase: FONT_FAMILY };
const darkTheme = { ...teamsDarkTheme, ...DARK_BRAND_TOKENS, fontFamilyBase: FONT_FAMILY };

// Buttons get `sc-btn-<appearance>` so index.css can style each appearance as glass.
const customStyleHooks = {
  useButtonStyles_unstable: (state: unknown) => {
    const s = state as { appearance?: string; root: { className?: string } };
    s.root.className = mergeClasses(s.root.className, `sc-btn-${s.appearance ?? 'secondary'}`);
  },
};

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
  const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
    // The Dex login theme reads this cookie; "system" removes it so Dex follows the OS.
    setSharedCookie(STORAGE_KEY, preference === 'system' ? null : preference);
  }, [preference]);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, setPreference, mode }),
    [preference, mode],
  );

  return (
    <ThemeContext value={value}>
      <FluentProvider
        customStyleHooks_unstable={customStyleHooks}
        theme={mode === 'dark' ? darkTheme : lightTheme}
        style={{ minHeight: '100dvh' }}
      >
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
