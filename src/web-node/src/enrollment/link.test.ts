import { describe, expect, it } from 'vitest';
import { codeFromHash, codeFromScan } from './link';

describe('codeFromHash', () => {
  it('reads and formats the code the web app put in the fragment', () => {
    expect(codeFromHash('#code=K7M2-QX9H4T')).toBe('K7M2-QX9H4T');
    expect(codeFromHash('#code=k7m2qx9h4t')).toBe('K7M2-QX9H4T');
  });
  it('ignores anything that is not a code', () => {
    expect(codeFromHash('')).toBe('');
    expect(codeFromHash('#code=nope')).toBe('');
    expect(codeFromHash('#other=K7M2-QX9H4T')).toBe('');
  });
});

describe('codeFromScan', () => {
  it('reads the code from the deep link the QR carries, or a bare code', () => {
    const link = `splitcortex://enroll?url=${encodeURIComponent('https://app.x/api')}&code=K7M2-QX9H4T`;
    expect(codeFromScan(link)).toBe('K7M2-QX9H4T');
    expect(codeFromScan(' k7m2qx9h4t ')).toBe('K7M2-QX9H4T');
  });
  it('ignores any other QR', () => {
    expect(codeFromScan('https://example.com')).toBe('');
    expect(codeFromScan('splitcortex://enroll?url=x&code=nope')).toBe('');
  });
});
