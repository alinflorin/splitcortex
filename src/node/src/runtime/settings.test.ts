import { MAX_CONTEXT, MIN_CONTEXT, parseContext } from './settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('parseContext', () => {
  it('treats empty as automatic and accepts whole numbers within the bounds', () => {
    expect(parseContext('')).toBe(0);
    expect(parseContext('  ')).toBe(0);
    expect(parseContext('3000')).toBe(3000);
    expect(parseContext(String(MIN_CONTEXT))).toBe(MIN_CONTEXT);
    expect(parseContext(String(MAX_CONTEXT))).toBe(MAX_CONTEXT);
  });
  it('rejects anything else', () => {
    for (const bad of ['abc', '12.5', '-4096', '511', String(MAX_CONTEXT + 1), '1e4', '4 096'])
      expect(parseContext(bad)).toBeNull();
  });
});
