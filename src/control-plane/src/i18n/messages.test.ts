import { describe, expect, it } from 'vitest';
import { en, ro, resolveLanguage, translate } from './messages';

describe('i18n', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(ro).sort()).toEqual(Object.keys(en).sort());
  });

  it('negotiates the language from Accept-Language', () => {
    expect(resolveLanguage(undefined)).toBe('en');
    expect(resolveLanguage('ro-RO,ro;q=0.9,en;q=0.8')).toBe('ro');
    expect(resolveLanguage('fr, en;q=0.5')).toBe('en');
    expect(resolveLanguage('de')).toBe('en');
    expect(resolveLanguage('en;q=0.4, ro;q=0.8')).toBe('ro');
  });

  it('fills placeholders and falls back to the key', () => {
    expect(translate('ro', 'errors.rangeLimit', { days: 92 })).toBe(
      'Intervalul este limitat la 92 zile',
    );
    expect(translate('en', 'nope')).toBe('nope');
  });
});
