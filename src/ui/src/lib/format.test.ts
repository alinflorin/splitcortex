import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes } from './format';

describe('format', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(3.4 * 1024 ** 3, 'en')).toBe('3.4 GB');
    expect(formatBytes(250 * 1024 ** 2, 'en')).toBe('250 MB');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(formatAgo('2026-01-01T11:59:30Z', 'en', now)).toBe('30 seconds ago');
    expect(formatAgo('2026-01-01T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatAgo('2026-01-01T09:00:00Z', 'en', now)).toBe('3 hours ago');
  });
});
