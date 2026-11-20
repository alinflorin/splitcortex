import { describe, expect, it } from 'vitest';
import { getWebNodeUrl } from './webNode';

describe('web node link', () => {
  it('derives the web node host from the web app host (the base domain)', () => {
    expect(getWebNodeUrl({ hostname: 'stg.splitcortex.com' })).toBe(
      'https://web-node.stg.splitcortex.com',
    );
    expect(getWebNodeUrl({ hostname: 'local.splitcortex.com' })).toBe(
      'https://web-node.local.splitcortex.com',
    );
  });
});
