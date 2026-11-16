import { describe, expect, it } from 'vitest';
import { getWebNodeUrl } from './webNode';

describe('web node link', () => {
  it('derives the web node host from the web app host', () => {
    expect(getWebNodeUrl({ hostname: 'app.stg.splitcortex.com' })).toBe(
      'https://web-node.stg.splitcortex.com',
    );
    expect(getWebNodeUrl({ hostname: 'app.splitcortex.127.0.0.1.nip.io' })).toBe(
      'https://web-node.splitcortex.127.0.0.1.nip.io',
    );
  });
});
