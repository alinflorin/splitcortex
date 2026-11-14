import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('makes url-safe slugs', () => {
    expect(slugify('  Acme  Inc. ')).toBe('acme-inc');
    expect(slugify('Școala Mică')).toBe('scoala-mica');
    expect(slugify('---')).toBe('');
  });
});
