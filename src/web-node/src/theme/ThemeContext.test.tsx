import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

function systemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('ThemeProvider', () => {
  it('defaults to system and follows the OS', () => {
    systemDark(true);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(result.current.mode).toBe('dark');
    expect(window.localStorage.getItem('sc-theme')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('persists an explicit choice and clears it for system', () => {
    systemDark(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setPreference('dark'));
    expect(result.current.mode).toBe('dark');
    expect(window.localStorage.getItem('sc-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    act(() => result.current.setPreference('system'));
    expect(result.current.mode).toBe('light');
    expect(window.localStorage.getItem('sc-theme')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('restores a stored preference', () => {
    window.localStorage.setItem('sc-theme', 'light');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('light');
  });

  it('useTheme throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Probe = () => <span>{useTheme().mode}</span>;
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
    expect(screen.queryByText('light')).toBeNull();
  });
});
