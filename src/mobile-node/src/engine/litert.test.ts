import { flatten } from './litert';

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
