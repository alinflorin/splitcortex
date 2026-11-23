import { describe, expect, it } from 'vitest';
import { languageOfPath, localizedPath, parsePublicPath } from './pages';

describe('localizedPath', () => {
  it('keeps the default language at the bare path and prefixes the others', () => {
    expect(localizedPath('/', 'en')).toBe('/');
    expect(localizedPath('/', 'ro')).toBe('/ro');
    expect(localizedPath('/about', 'en')).toBe('/about');
    expect(localizedPath('/about', 'ro')).toBe('/ro/about');
  });

  it('keeps a hash or query and leaves the signed-in app alone', () => {
    expect(localizedPath('/#run', 'ro')).toBe('/ro#run');
    expect(localizedPath('/organisations', 'ro')).toBe('/organisations');
    expect(localizedPath('/playground', 'ro')).toBe('/playground');
  });
});

describe('parsePublicPath', () => {
  it('finds the page and the language of every public URL', () => {
    expect(parsePublicPath('/')).toMatchObject({ page: { key: 'home' }, lng: 'en' });
    expect(parsePublicPath('/ro')).toMatchObject({ page: { key: 'home' }, lng: 'ro' });
    expect(parsePublicPath('/ro/')).toMatchObject({ page: { key: 'home' }, lng: 'ro' });
    expect(parsePublicPath('/privacy')).toMatchObject({ page: { key: 'privacy' }, lng: 'en' });
    expect(parsePublicPath('/ro/contact/')).toMatchObject({ page: { key: 'contact' }, lng: 'ro' });
  });

  it('is null for the signed-in app and unknown URLs', () => {
    expect(parsePublicPath('/organisations')).toBeNull();
    expect(parsePublicPath('/ro/organisations')).toBeNull();
    expect(parsePublicPath('/ro/nope')).toBeNull();
    expect(parsePublicPath('/robots')).toBeNull();
  });
});

describe('languageOfPath', () => {
  it('only a language prefix counts', () => {
    expect(languageOfPath('/ro')).toBe('ro');
    expect(languageOfPath('/ro/anything')).toBe('ro');
    expect(languageOfPath('/about')).toBeNull();
    expect(languageOfPath('/rome')).toBeNull();
  });
});
