import { describe, expect, it } from 'vitest';
import { FOLDS_KEPT, foldContaining, foldHeads, foldableAt, foldableRanges, foldsHiding, parseFolds, pruneFolds, restoreFolds, withFolds } from './folds';

const lines = (text: string): string[] => text.split('\n');

describe('foldableRanges', () => {
  it('gives a heading its section down to the next heading at or above its level', () => {
    const r = foldableRanges(lines('# One\ntext\n## Two\nmore\n### Three\ndeep\n## Four\nend\n# Five\n'));
    expect(r.map((x) => [x.kind, x.head, x.end, x.depth, x.text])).toEqual([
      ['heading', 0, 8, 1, 'One'],
      ['heading', 2, 6, 2, 'Two'],
      ['heading', 4, 6, 3, 'Three'],
      ['heading', 6, 8, 2, 'Four'],
    ]);
  });

  it('does not fold an empty section, and leaves blank lines before the next heading to nobody', () => {
    const r = foldableRanges(lines('# A\n\n\n# B\nwords\n\n# C'));
    expect(r.map((x) => [x.text, x.head, x.end])).toEqual([['B', 3, 5]]);
  });

  it('folds a list item with an indented sub-list, and not one without', () => {
    const r = foldableRanges(lines('- one\n  - one a\n  - one b\n- two\n- three\n    continued\n'));
    expect(r.map((x) => [x.kind, x.head, x.end, x.depth, x.text])).toEqual([
      ['list', 0, 3, 0, 'one'],
      ['list', 4, 6, 0, 'three'],
    ]);
  });

  it('ignores headings and lists inside a fence', () => {
    const r = foldableRanges(lines('```\n# not\n- nor\n  - this\n```\n# yes\nwords'));
    expect(r.map((x) => x.text)).toEqual(['yes']);
  });

  it('finds the head at a line and the innermost fold around a line', () => {
    const r = foldableRanges(lines('# A\n## B\n- x\n  - y\ntext\n'));
    expect(foldableAt(r, 1)?.text).toBe('B');
    expect(foldableAt(r, 4)).toBeNull();
    expect(foldContaining(r, 3)?.text).toBe('x');
    expect(foldContaining(r, 4)?.text).toBe('B');
    expect(foldContaining(r, 0)).toBeNull();
  });

  it('names the folds hiding a line, outermost first', () => {
    const r = foldableRanges(lines('# A\n## B\n### C\nwords'));
    expect(foldsHiding(r, new Set([0, 2]), 3).map((x) => x.text)).toEqual(['A', 'C']);
    expect(foldsHiding(r, new Set([1]), 1)).toEqual([]);
  });
});

describe('remembering folds', () => {
  it('keeps a fold on a line that still heads the same thing, moves one whose line changed, drops one that is ambiguous', () => {
    const before = foldableRanges(lines('# A\na\n# B\nb'));
    const heads = foldHeads(before, new Set([0, 2]));
    expect(heads).toEqual([
      { line: 0, kind: 'heading', depth: 1, text: 'A' },
      { line: 2, kind: 'heading', depth: 1, text: 'B' },
    ]);
    // A line added above: A moved to 1, B to 3.
    const moved = foldableRanges(lines('intro\n# A\na\n# B\nb'));
    expect([...restoreFolds(moved, heads)]).toEqual([1, 3]);
    // B written twice, and B's own line moved: nobody knows which; A stays.
    const twice = foldableRanges(lines('# A\na\nx\n# B\nb\n# B\nb2'));
    expect([...restoreFolds(twice, heads)]).toEqual([0]);
    // A's line now heads something else with the same words at another depth: relocated.
    const deeper = foldableRanges(lines('## A\na\n# B\nb'));
    expect([...restoreFolds(deeper, heads)]).toEqual([2]);
  });

  it('writes one note, forgets a note with none, and evicts the least recently changed past the cap', () => {
    let store = withFolds({}, 'n1', [{ line: 0, kind: 'heading', depth: 1, text: 'A' }], 1);
    expect(Object.keys(store)).toEqual(['n1']);
    store = withFolds(store, 'n1', [], 2);
    expect(store).toEqual({});
    for (let i = 0; i < FOLDS_KEPT + 5; i++) store = withFolds(store, `n${i}`, [{ line: 0, kind: 'list', depth: 0, text: 'x' }], i + 10);
    expect(Object.keys(store)).toHaveLength(FOLDS_KEPT);
    expect(store.n0).toBeUndefined();
    expect(store.n4).toBeUndefined();
    expect(store.n5).toBeDefined();
  });

  it('prunes notes that are gone and reads only well-formed heads back', () => {
    const store = { a: { updatedAt: 1, heads: [{ line: 0, kind: 'heading' as const, depth: 1, text: 'A' }] }, b: { updatedAt: 1, heads: [{ line: 0, kind: 'list' as const, depth: 0, text: 'x' }] } };
    expect(Object.keys(pruneFolds(store, (id) => id === 'a'))).toEqual(['a']);
    expect(parseFolds({ a: { updatedAt: 1, heads: [{ line: 0, kind: 'heading', depth: 1, text: 'A' }, { line: 'x' }, null] }, b: 'junk', c: { heads: [] } })).toEqual({
      a: { updatedAt: 1, heads: [{ line: 0, kind: 'heading', depth: 1, text: 'A' }] },
    });
    expect(parseFolds(null)).toEqual({});
  });
});
