import { describe, expect, it } from 'vitest';
import { nextFootnoteId, scanFootnotes, withDefinitionText, withInlineText, withNewDefinition } from './footnotes';

describe('scanFootnotes', () => {
  it('finds references, definitions and inline notes, and numbers by first reference', () => {
    const scan = scanFootnotes('Two[^b] one[^a] two[^b] in^[line].\n\n[^a]: A\n[^b]: B\n    more');
    expect(scan.refs.map((r) => r.id)).toEqual(['b', 'a', 'b']);
    expect(scan.defs.map((d) => [d.id, d.text, d.start, d.end])).toEqual([
      ['a', 'A', 2, 3],
      ['b', 'B\nmore', 3, 5],
    ]);
    expect(scan.entries.map((e) => [e.kind, e.number, e.kind === 'named' ? e.id : e.note.text])).toEqual([
      ['named', 1, 'b'],
      ['named', 2, 'a'],
      ['inline', 3, 'line'],
    ]);
    const b = scan.entries[0];
    expect(b.kind === 'named' && b.refs.length).toBe(2);
  });

  it('reports what is undefined, unreferenced and duplicated', () => {
    const scan = scanFootnotes('x[^gone] y[^gone] z[^here]\n\n[^here]: h\n[^lonely]: l\n[^here]: again');
    expect(scan.undefined).toEqual(['gone']);
    expect(scan.unreferenced.map((d) => d.id)).toEqual(['lonely']);
    expect(scan.duplicates.map((d) => d.text)).toEqual(['again']);
    expect(scan.entries).toHaveLength(1);
  });

  it('skips code fences, code spans and escaped brackets', () => {
    const scan = scanFootnotes('`[^a]` \\[^a] ^[real] `^[not]`\n\n```\n[^a]: fenced\n```\n\n[^a]: yes');
    expect(scan.refs).toEqual([]);
    expect(scan.inlines.map((n) => n.text)).toEqual(['real']);
    expect(scan.defs.map((d) => d.text)).toEqual(['yes']);
  });

  it('reads an inline note with nested brackets and an escape', () => {
    const [n] = scanFootnotes('a ^[see [[Plan]] and \\] done] b').inlines;
    expect(n.text).toBe('see [[Plan]] and \\] done');
    expect(n.col).toBe(2);
  });

  it('keeps a blank line inside a definition when an indented line follows it', () => {
    const [d] = scanFootnotes('[^a]: one\n\n    two\n\nnot part').defs;
    expect(d.text).toBe('one\n\ntwo');
    expect(d.end).toBe(3);
  });
});

describe('ids and rewrites', () => {
  it('picks the next number above the largest in use, or 1', () => {
    expect(nextFootnoteId('a[^3] b[^12]\n\n[^3]: x')).toBe('13');
    expect(nextFootnoteId('a[^smith]\n\n[^smith]: x')).toBe('1');
    expect(nextFootnoteId('')).toBe('1');
  });

  it('rewrites a definition, putting the four spaces back on continuation lines', () => {
    const body = 'x[^a]\n\n[^a]: old\n    lines\n\nafter';
    const [def] = scanFootnotes(body).defs;
    expect(withDefinitionText(body, def, 'new\n\nsecond para')).toBe('x[^a]\n\n[^a]: new\n\n    second para\n\nafter');
    expect(withDefinitionText(body, def, '')).toBe('x[^a]\n\n[^a]:\n\nafter');
  });

  it('rewrites the words of an inline note on one line', () => {
    const body = 'a ^[old] b';
    const [n] = scanFootnotes(body).inlines;
    expect(withInlineText(body, n, 'new\nwords')).toBe('a ^[new words] b');
  });

  it('appends a new definition after a blank line and says where the caret goes', () => {
    expect(withNewDefinition('words\n', 'x')).toEqual({ body: 'words\n\n[^x]: ', at: 13 });
    expect(withNewDefinition('', '1')).toEqual({ body: '[^1]: ', at: 6 });
  });
});
