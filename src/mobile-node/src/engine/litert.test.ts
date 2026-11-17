import { flatten, mediaOf } from './litert';

describe('flatten', () => {
  it('keeps a single user turn as is and joins system turns', () => {
    expect(
      flatten([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ]),
    ).toEqual({
      system: 'be brief',
      prompt: 'hi',
    });
  });
  it('replays a longer history as a transcript ending on the assistant', () => {
    const r = flatten([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(r.prompt).toBe('User: a\nAssistant: b\nUser: c\nAssistant:');
  });
});

describe('media', () => {
  const png = new Uint8Array([9, 1, 2, 3]).subarray(1); // a view into a larger buffer
  const wav = new Uint8Array([4, 5]);
  const withMedia = [
    {
      role: 'user',
      content: 'old',
      parts: [
        { type: 'text' as const, text: 'old' },
        { type: 'image' as const, mimeType: 'image/png', data: new Uint8Array([7]) },
      ],
    },
    { role: 'assistant', content: 'ok' },
    {
      role: 'user',
      content: 'what is this?',
      parts: [
        { type: 'text' as const, text: 'what is this?' },
        { type: 'image' as const, mimeType: 'image/png', data: png },
        { type: 'audio' as const, mimeType: 'audio/wav', data: wav },
      ],
    },
  ];

  it('only sends the last turn media, earlier turns show a placeholder', () => {
    expect(flatten(withMedia).prompt).toBe(
      'User: old\n[Image]\nAssistant: ok\nUser: what is this?\nAssistant:',
    );
    const parts = mediaOf(withMedia);
    expect(parts.map((p) => p.type)).toEqual(['image', 'audio']);
  });

  it('copies exactly the bytes of a view, not the whole backing buffer', () => {
    const [image] = mediaOf(withMedia);
    expect(image && 'imageBuffer' in image && [...new Uint8Array(image.imageBuffer)]).toEqual([
      1, 2, 3,
    ]);
  });

  it('has no media for a text message', () => {
    expect(mediaOf([{ role: 'user', content: 'hi' }])).toEqual([]);
  });
});
