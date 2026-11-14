import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, isAllowedHfHost, normaliseHuggingFaceUrl } from './hf';
import { partSizeFor } from '../routes/models';

describe('huggingface urls', () => {
  it('turns page urls into resolve urls and drops query and fragment', () => {
    expect(
      normaliseHuggingFaceUrl(
        'https://huggingface.co/acme/m/blob/main/gemma.litertlm?download=true#x',
      ),
    ).toBe('https://huggingface.co/acme/m/resolve/main/gemma.litertlm');
    expect(normaliseHuggingFaceUrl('https://huggingface.co/acme/m/resolve/v1/a/b.litertlm')).toBe(
      'https://huggingface.co/acme/m/resolve/v1/a/b.litertlm',
    );
    expect(
      fileNameFromUrl('https://huggingface.co/acme/m/resolve/main/sub/gemma%203.litertlm'),
    ).toBe('gemma 3.litertlm');
  });

  it('only allows Hugging Face hosts', () => {
    for (const ok of [
      'huggingface.co',
      'cdn-lfs.huggingface.co',
      'cas-bridge.xethub.hf.co',
      'hf.co',
    ])
      expect(isAllowedHfHost(ok)).toBe(true);
    for (const bad of ['evil.com', 'huggingface.co.evil.com', 'nothuggingface.co', 'localhost'])
      expect(isAllowedHfHost(bad)).toBe(false);
  });

  it('keeps multipart uploads under the part limit', () => {
    expect(partSizeFor(1)).toBe(8 * 1024 ** 2);
    const huge = 32 * 1024 ** 3;
    expect(Math.ceil(huge / partSizeFor(huge))).toBeLessThanOrEqual(10_000);
  });
});
