import { useCallback, useState } from 'react';

/** A boolean kept in localStorage (e.g. a collapsed sidebar). Storage failures are ignored. */
export function useStoredBoolean(
  key: string,
  initial = false,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // private mode or storage disabled: the choice just lasts for this visit
      }
    },
    [key],
  );
  return [value, set];
}
