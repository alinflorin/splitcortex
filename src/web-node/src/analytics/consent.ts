import { useSyncExternalStore } from 'react';

/** What the visitor chose about analytics cookies; `null` = not asked yet. */
export type Consent = 'granted' | 'denied' | null;

const KEY = 'sc-consent';
const listeners = new Set<() => void>();
let memory: Consent = null; // the choice when storage is unavailable
let reopened = false;

export function getConsent(): Consent {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

const emit = () => listeners.forEach((l) => l());

export function setConsent(value: 'granted' | 'denied'): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // storage disabled: the choice lasts until the page is closed
    memory = value;
  }
  reopened = false;
  emit();
}

/** "Cookie settings": ask again, with the current choice still in force until the visitor picks. */
export function reopenConsent(): void {
  reopened = true;
  emit();
}

const snapshot = () => `${getConsent() ?? memory ?? 'none'}|${reopened}`;

/** The saved choice, and whether the banner was asked for again. Server render: undecided. */
export function useConsent(): { consent: Consent; asking: boolean } {
  const state = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot,
    () => 'none|false',
  );
  const [choice, again] = state.split('|');
  return {
    consent: choice === 'granted' || choice === 'denied' ? choice : null,
    asking: again === 'true',
  };
}
