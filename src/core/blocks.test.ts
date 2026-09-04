import { describe, expect, it } from 'vitest';
import { blockAtLine, blockOf, blocksIn, markerOn, newBlockId, normalizeId, summarize, withBlockId } from './blocks';

describe('markerOn', () => {
  it('reads a marker at the end of a line and one on a line of its own', () => {
    expect(markerOn('A paragraph. ^k3n9dq')).toEqual({ id: 'k3n9dq', standalone: false });
    expect(markerOn('  ^k3n9dq')).toEqual({ id: 'k3n9dq', standalone: true });
    expect(markerOn('A paragraph.')).toBe(null);
  });

  it('needs whitespace before an inline marker, so a caret mid-word is text', () => {
    expect(markerOn('two^three')).toBe(null);
    expect(markerOn('maths: 2^10')).toBe(null);
  });
});

describe('blocksIn', () => {
  it('finds a paragraph, and takes the marker off its content', () => {
    const found = blocksIn('First line\nsecond line ^abc123\n\nAnother.');
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ id: 'abc123', kind: 'paragraph', start: 0, end: 2 });
    expect(found[0].content).toBe('First line\nsecond line');
    expect(found[1]).toMatchObject({ id: '', kind: 'paragraph' });
  });

  it('gives a list item its whole subtree, brought back to the left', () => {
    const body = '- Decision ^abc123\n  - Supporting detail\n    - Deeper\n- Next item';
    const item = blocksIn(body).find((b) => b.id === 'abc123');
    expect(item?.kind).toBe('list-item');
    expect(item?.content).toBe('- Decision\n  - Supporting detail\n    - Deeper');
    const nested = blocksIn('- Top\n  - Middle ^zzz111\n    - Under it\n- Next');
    expect(nested.find((b) => b.id === 'zzz111')?.content).toBe('- Middle\n  - Under it');
  });

  it('addresses a heading line only, never the section under it', () => {
    const found = blocksIn('## Decision ^abc123\n\nWords under the heading.');
    const heading = found.find((b) => b.id === 'abc123');
    expect(heading).toMatchObject({ kind: 'heading', start: 0, end: 1 });
    expect(heading?.content).toBe('## Decision');
  });

  it('takes a marker on its own line for the table or fence just above it', () => {
    const table = blocksIn('| a | b |\n| --- | --- |\n| 1 | 2 |\n^tbl001\n\nAfter.');
    expect(table[0]).toMatchObject({ id: 'tbl001', kind: 'table', start: 0, end: 4 });
    expect(table[0].content).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const code = blocksIn('```js\nconst a = 1;\n```\n^cod001');
    expect(code[0]).toMatchObject({ id: 'cod001', kind: 'code' });
    expect(code[0].content).toBe('```js\nconst a = 1;\n```');
  });

  it('reads a blockquote as one block, marker on its last line', () => {
    const found = blocksIn('> One\n> Two ^qqq111\n\nAfter.');
    expect(found[0]).toMatchObject({ id: 'qqq111', kind: 'blockquote' });
    expect(found[0].content).toBe('> One\n> Two');
  });

  it('ignores a marker written inside a fence: those are the characters that were typed', () => {
    const found = blocksIn('```\nA paragraph. ^abc123\n```\n\nReal text.');
    expect(found.some((b) => b.id === 'abc123')).toBe(false);
  });

  it('leaves an unclosed fence unaddressable', () => {
    expect(blocksIn('```js\nnever closed\nmore').filter((b) => b.kind === 'code')).toEqual([]);
  });

  it('does not address a rule or a blank line', () => {
    expect(blocksIn('One.\n\n---\n\nTwo.').map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });
});

describe('blockOf', () => {
  const body = 'One. ^aaa111\n\nTwo. ^bbb222\n\nThree. ^aaa111';

  it('answers none, one, or more than one — and never chooses', () => {
    expect(blockOf(body, 'bbb222')).toMatchObject({ kind: 'one' });
    expect(blockOf(body, 'missing')).toEqual({ kind: 'none' });
    const many = blockOf(body, 'aaa111');
    expect(many.kind).toBe('many');
    if (many.kind === 'many') expect(many.blocks).toHaveLength(2);
  });

  it('takes an id written with or without its caret', () => {
    expect(blockOf(body, '^bbb222').kind).toBe('one');
    expect(normalizeId(' ^bbb222 ')).toBe('bbb222');
  });
});

describe('withBlockId', () => {
  it('writes an inline marker at the end of the block, and a list item on its own line', () => {
    const body = 'A paragraph\nover two lines\n\n- An item\n  - a child';
    const para = blocksIn(body)[0];
    expect(withBlockId(body, para, 'new001')).toBe('A paragraph\nover two lines ^new001\n\n- An item\n  - a child');
    const item = blocksIn(body).find((b) => b.kind === 'list-item')!;
    expect(withBlockId(body, item, 'new002')).toBe('A paragraph\nover two lines\n\n- An item ^new002\n  - a child');
  });

  it('writes a table marker on the line after it, with no blank between', () => {
    const body = '| a |\n| --- |\n| 1 |';
    expect(withBlockId(body, blocksIn(body)[0], 'tbl999')).toBe('| a |\n| --- |\n| 1 |\n^tbl999');
  });

  it('makes an id the note does not already carry, six characters long', () => {
    const id = newBlockId('Some words.');
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    // A generator that always says the same thing must still not repeat an id.
    const stuck = newBlockId('One. ^aaaaaa', () => 0);
    expect(stuck).not.toBe('aaaaaa');
  });
});

describe('blockAtLine and summarize', () => {
  it('finds the block a line is inside', () => {
    const body = 'One.\n\n- item\n  - child\n\nTwo.';
    expect(blockAtLine(body, 3)?.kind).toBe('list-item');
    expect(blockAtLine(body, 1)).toBe(null);
    expect(blockAtLine(body, 5)?.kind).toBe('paragraph');
  });

  it('describes a block in one line, markers and bullets stripped', () => {
    const [block] = blocksIn('- **Decide** the thing ^abc123\n  - and the other');
    expect(summarize(block)).toBe('**Decide** the thing and the other');
    expect(summarize(blocksIn('#### A heading')[0])).toBe('A heading');
  });
});
