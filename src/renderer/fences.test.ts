import { describe, expect, it } from 'vitest';
import { isFenceLine, toggleFence } from './fences';

describe('isFenceLine', () => {
  it('recognises backtick and tilde fences, with or without a language', () => {
    expect(isFenceLine('```')).toBe(true);
    expect(isFenceLine('```js')).toBe(true);
    expect(isFenceLine('~~~')).toBe(true);
    expect(isFenceLine('   ```')).toBe(true);
  });

  it('leaves ordinary lines alone', () => {
    expect(isFenceLine('``')).toBe(false);
    expect(isFenceLine('some `code` here')).toBe(false);
    expect(isFenceLine('')).toBe(false);
  });
});

describe('toggleFence', () => {
  it('wraps a block and leaves the caret on its last line', () => {
    const out = toggleFence('a\nb', 0, 1);
    expect(out.body).toBe('```\na\nb\n```');
    expect(out.line).toBe(2);
  });

  it('names the language when one is given', () => {
    expect(toggleFence('a', 0, 0, 'js').body).toBe('```js\na\n```');
  });

  it('unwraps when the block is already fenced', () => {
    expect(toggleFence('```\na\nb\n```', 1, 2).body).toBe('a\nb');
  });

  it('unwraps from the fence lines themselves', () => {
    expect(toggleFence('```js\na\n```', 0, 2).body).toBe('a');
  });

  it('leaves the rest of the note where it was', () => {
    const out = toggleFence('before\n\ncode\n\nafter', 2, 2);
    expect(out.body).toBe('before\n\n```\ncode\n```\n\nafter');
  });

  it('round-trips', () => {
    const wrapped = toggleFence('x\ny', 0, 1);
    expect(toggleFence(wrapped.body, 1, 2).body).toBe('x\ny');
  });

  it('fences an empty line into a block to type in', () => {
    expect(toggleFence('', 0, 0).body).toBe('```\n\n```');
  });
});
