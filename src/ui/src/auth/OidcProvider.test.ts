import { describe, expect, it } from 'vitest';
import { isDefinitiveRenewError } from './OidcProvider';

describe('isDefinitiveRenewError', () => {
  it('treats a rejected refresh token as definitive', () => {
    expect(isDefinitiveRenewError({ error: 'invalid_grant' })).toBe(true);
  });
  it('treats network errors as transient', () => {
    expect(isDefinitiveRenewError(new Error('Network Error'))).toBe(false);
    expect(isDefinitiveRenewError(null)).toBe(false);
  });
});
