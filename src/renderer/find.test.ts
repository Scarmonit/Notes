import { describe, expect, it } from 'vitest';
import { findMatches, matchFrom, replaceAll, replaceOne, validQuery } from './find';

const plain = { caseSensitive: false, regex: false };
const exact = { caseSensitive: true, regex: false };
const re = { caseSensitive: false, regex: true };

describe('findMatches', () => {
  it('finds every occurrence, ignoring case by default', () => {
    expect(findMatches('Cat cat CAT', 'cat', plain)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    expect(findMatches('Cat cat CAT', 'cat', exact)).toEqual([{ start: 4, end: 7 }]);
  });

  it('treats the query as literal text unless asked for a regex', () => {
    expect(findMatches('a.c abc', 'a.c', plain)).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches('a.c abc', 'a.c', re)).toHaveLength(2);
  });

  it('skips empty matches and bad patterns', () => {
    expect(findMatches('aaa', 'x*', re)).toEqual([]);
    expect(findMatches('aaa', '(', re)).toEqual([]);
    expect(findMatches('aaa', '', plain)).toEqual([]);
    expect(validQuery('(', re)).toBe(false);
    expect(validQuery('(', plain)).toBe(true);
  });

  it('matches across lines', () => {
    expect(findMatches('one\ntwo\none', 'one', plain)).toHaveLength(2);
  });
});

describe('matchFrom', () => {
  const ms = findMatches('x a x a x a', 'a', plain);
  it('picks the first match at or after the offset, wrapping', () => {
    expect(matchFrom(ms, 0)).toBe(0);
    expect(matchFrom(ms, 2)).toBe(0);
    expect(matchFrom(ms, 3)).toBe(1);
    expect(matchFrom(ms, 99)).toBe(0);
    expect(matchFrom([], 0)).toBe(-1);
  });
});

describe('replace', () => {
  it('replaces one match and leaves the rest', () => {
    const text = 'cat cat cat';
    const ms = findMatches(text, 'cat', plain);
    expect(replaceOne(text, ms[1], 'cat', 'dog', plain)).toBe('cat dog cat');
  });

  it('replaces every match and counts them', () => {
    expect(replaceAll('cat Cat cat', 'cat', 'dog', plain)).toEqual({ text: 'dog dog dog', count: 3 });
    expect(replaceAll('nothing here', 'cat', 'dog', plain)).toEqual({ text: 'nothing here', count: 0 });
  });

  it('expands groups in regex mode and not otherwise', () => {
    expect(replaceAll('2026-09-03', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', re).text).toBe('03/09/2026');
    expect(replaceAll('a$1', '$1', 'x', plain).text).toBe('ax');
  });
});

describe('regex replace with context', () => {
  it('expands a match that only exists in context, such as a lookaround or an anchor', () => {
    expect(replaceOne('ab', findMatches('ab', 'a(?=b)', re)[0], 'a(?=b)', 'X', re)).toBe('Xb');
    expect(replaceAll('foobar foobaz', '(?<=foo)ba(r|z)', '[$1]', re)).toEqual({ text: 'foo[r] foo[z]', count: 2 });
    expect(replaceAll('one\ntwo', '^t', 'T', { ...re })).toEqual({ text: 'one\ntwo', count: 0 });
  });
});
