import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) => {
    matches = next;
    listeners.forEach((fn) => fn());
  };
}

describe('useMediaQuery', () => {
  it('returns the current match and follows changes', () => {
    const set = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    expect(result.current).toBe(false);
    act(() => set(true));
    expect(result.current).toBe(true);
  });
});
