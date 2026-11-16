import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as RN from 'react-native';
import { ThemeProvider, darkTheme, lightTheme, useTheme } from './ThemeContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('ThemeProvider', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('defaults to system and follows the OS', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(result.current.mode).toBe('dark');
    expect(result.current.theme).toBe(darkTheme);
  });

  it('persists an explicit choice and clears it for system', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe(lightTheme);
    await act(async () => result.current.setPreference('dark'));
    expect(result.current.mode).toBe('dark');
    expect(await AsyncStorage.getItem('sc-theme')).toBe('dark');
    await act(async () => result.current.setPreference('system'));
    expect(result.current.mode).toBe('light');
    expect(await AsyncStorage.getItem('sc-theme')).toBeNull();
  });

  it('restores a stored preference', async () => {
    await AsyncStorage.setItem('sc-theme', 'dark');
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const { result } = await renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe('dark'));
  });
});
