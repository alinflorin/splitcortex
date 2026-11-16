import {
  fingerprint,
  formatCodeInput,
  fromB64,
  open,
  parseCode,
  parseEnrollLink,
  seal,
  toB64,
} from './crypto';

describe('enrollment crypto', () => {
  it('normalises typed codes', () => {
    expect(parseCode('k7m2-qx9h4t')).toEqual({ lookupId: 'K7M2', secret: 'QX9H4T' });
    expect(parseCode('O0I1-L1O0AB')).toEqual({ lookupId: '0011', secret: '1100AB' });
    expect(parseCode('short')).toBeNull();
    expect(parseCode('ABCD-EFGU12')).toBeNull();
  });

  it('formats while typing', () => {
    expect(formatCodeInput('k7m2qx')).toBe('K7M2-QX');
    expect(formatCodeInput('K7M2')).toBe('K7M2');
    expect(formatCodeInput('k7m2-qx9h4tzzz')).toBe('K7M2-QX9H4T');
  });

  it('matches the control plane fingerprint vectors', () => {
    expect(fingerprint(new Uint8Array(32))).toBe('CSM7-NBFR-CAYQ');
    expect(fingerprint(new Uint8Array(32).fill(7))).toBe('9ER6-Z3JE-79VH');
  });

  it('round-trips base64url without padding', () => {
    const b = Uint8Array.from([251, 255, 0, 1, 2]);
    expect(toB64(b)).toBe('-_8AAQI');
    expect(Array.from(fromB64('-_8AAQI'))).toEqual(Array.from(b));
  });

  it('seals and opens, and rejects a wrong key or tampering', () => {
    const isk = new Uint8Array(64).fill(1);
    const sid = new Uint8Array(16).fill(2);
    const sealed = seal(isk, sid, 'request', new TextEncoder().encode('hi'), new Uint8Array(12));
    expect(new TextDecoder().decode(open(isk, sid, 'request', sealed)!)).toBe('hi');
    expect(open(new Uint8Array(64).fill(9), sid, 'request', sealed)).toBeNull();
    expect(open(isk, sid, 'response', sealed)).toBeNull(); // labels are separate keys
    const bad = Uint8Array.from(sealed);
    bad[bad.length - 1] ^= 1;
    expect(open(isk, sid, 'request', bad)).toBeNull();
  });

  it('parses the QR deep link', () => {
    const link = `splitcortex://enroll?url=${encodeURIComponent('https://app.example.com/api')}&code=K7M2-QX9H4T`;
    expect(parseEnrollLink(link)).toEqual({
      url: 'https://app.example.com/api',
      code: 'K7M2-QX9H4T',
    });
    expect(parseEnrollLink('https://example.com')).toBeNull();
    expect(parseEnrollLink('splitcortex://enroll?url=x&code=bad')).toBeNull();
  });
});
