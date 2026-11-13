import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOidcConfig, getDexAuthority, OIDC_CLIENT_ID } from './oidc';

describe('getDexAuthority', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['app.splitcortex.127.0.0.1.nip.io', 'https://dex.splitcortex.127.0.0.1.nip.io'],
    ['app.stg.splitcortex.com', 'https://dex.stg.splitcortex.com'],
    ['app.prd.splitcortex.com', 'https://dex.prd.splitcortex.com'],
  ])('maps %s to %s', (hostname, expected) => {
    expect(getDexAuthority({ hostname })).toBe(expected);
  });

  it('only replaces a leading app. label', () => {
    expect(getDexAuthority({ hostname: 'myapp.example.com' })).toBe('https://myapp.example.com');
  });

  it('prefers VITE_OIDC_AUTHORITY', () => {
    vi.stubEnv('VITE_OIDC_AUTHORITY', 'https://dex.example.test');
    expect(getDexAuthority({ hostname: 'app.stg.splitcortex.com' })).toBe(
      'https://dex.example.test',
    );
  });
});

describe('buildOidcConfig', () => {
  it('is a public code + PKCE client with silent renew', () => {
    const cfg = buildOidcConfig();
    expect(cfg.client_id).toBe(OIDC_CLIENT_ID);
    expect(cfg.response_type).toBe('code');
    expect(cfg.scope).toContain('offline_access');
    expect(cfg.automaticSilentRenew).toBe(true);
    expect(cfg.client_secret).toBeUndefined();
    expect(cfg.redirect_uri).toBe(`${window.location.origin}/`);
  });
});
