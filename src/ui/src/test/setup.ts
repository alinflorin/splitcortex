import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no matchMedia; default to "no match" (light). Tests override with vi.stubGlobal.
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

// Fluent components (MessageBar etc.) use ResizeObserver, which jsdom lacks.
// (assigned directly, not via vi.stubGlobal: tests call vi.unstubAllGlobals() to restore `fetch`)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
