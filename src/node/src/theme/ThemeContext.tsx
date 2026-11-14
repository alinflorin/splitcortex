import AsyncStorage from '@react-native-async-storage/async-storage';
import { teamsDarkTheme, teamsLightTheme, type Theme } from '@fluentui/tokens';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

// Same Fluent tokens as the web app. Inter is bundled (no CDN); React Native has no variable
// fonts, so each weight is its own family (see fonts.ts).
export const lightTheme: Theme = teamsLightTheme;
export const darkTheme: Theme = teamsDarkTheme;

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'sc-theme';

interface ThemeContextValue {
  /** What the user chose; `system` follows the OS and is the default. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** The theme actually applied. */
  mode: ThemeMode;
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const system = useColorScheme();

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') setPreferenceState(stored);
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (next === 'system') void AsyncStorage.removeItem(STORAGE_KEY);
    else void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const mode: ThemeMode =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo<ThemeContextValue>(
    () => ({ preference, setPreference, mode, theme: mode === 'dark' ? darkTheme : lightTheme }),
    [preference, setPreference, mode],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
