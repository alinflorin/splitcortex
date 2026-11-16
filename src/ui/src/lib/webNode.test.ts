import { describe, expect, it } from 'vitest';
import { getWebNodeUrl, webNodeJoinUrl } from './webNode';

describe('web node link', () => {
  it('derives the web node host from the web app host', () => {
    expect(getWebNodeUrl({ hostname: 'app.stg.splitcortex.com' })).toBe(
      'https://web-node.stg.splitcortex.com',
    );
    expect(getWebNodeUrl({ hostname: 'app.splitcortex.127.0.0.1.nip.io' })).toBe(
      'https://web-node.splitcortex.127.0.0.1.nip.io',
    );
  });

  it('puts the code in the fragment, not in the query', () => {
    const url = webNodeJoinUrl('https://web-node.x.com/', 'K7M2-QX9H4T');
    expect(url).toBe('https://web-node.x.com/#code=K7M2-QX9H4T');
    expect(new URL(url).search).toBe('');
  });
});
