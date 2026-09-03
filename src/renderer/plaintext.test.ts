import { describe, expect, it } from 'vitest';
import { markdownToText } from './plaintext';

describe('markdownToText', () => {
  it('flattens headings and emphasis', () => {
    expect(markdownToText('# Title\n\nSome **bold** and _quiet_ text with `code`.')).toBe(
      'Title\n\nSome bold and quiet text with code.\n'
    );
  });

  it('keeps list markers, numbering, task boxes and nesting', () => {
    expect(markdownToText('- one\n- two\n  - nested')).toBe('- one\n- two\n  - nested\n');
    expect(markdownToText('3. c\n4. d')).toBe('3. c\n4. d\n');
    expect(markdownToText('- [x] done\n- [ ] todo')).toBe('- [x] done\n- [ ] todo\n');
  });

  it('writes links as text (url) and images as [image: alt]', () => {
    expect(markdownToText('[site](https://example.com) or <https://x.y>')).toBe('site (https://example.com) or https://x.y\n');
    expect(markdownToText('![cat](note-asset://deadbeef.png)\n\n![](note-asset://deadbeef.png)')).toBe('[image: cat]\n\n[image]\n');
  });

  it('keeps code, quotes, rules and tables readable', () => {
    expect(markdownToText('```js\nlet x = 1;\n```')).toBe('let x = 1;\n');
    expect(markdownToText('> quoted\n> line two')).toBe('> quoted\n> line two\n');
    expect(markdownToText('a\n\n---\n\nb')).toBe('a\n\n---\n\nb\n');
    expect(markdownToText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a | b\n1 | 2\n');
  });

  it('preserves line breaks and literal characters', () => {
    expect(markdownToText('line one\nline two')).toBe('line one\nline two\n');
    expect(markdownToText('Tom & Jerry <3 "quotes"')).toBe('Tom & Jerry <3 "quotes"\n');
  });

  it('returns an empty string for an empty note', () => {
    expect(markdownToText('')).toBe('');
    expect(markdownToText('  \n\n ')).toBe('');
  });
});
