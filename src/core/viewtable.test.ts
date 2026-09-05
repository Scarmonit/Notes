import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { parseQuery } from './query';
import { cardColumns, cellOf, cellText, columnsOf, compareNotes, defaultColumns, editText, editorKind, firstLine, groupNotes, parseCellInput, sortNotes, viewTabLabel, withSortClick } from './viewtable';

const note = (id: string, body: string, props: Record<string, unknown> = {}, updatedAt = 1): Note => ({
  id,
  body,
  createdAt: 1,
  updatedAt,
  properties: Object.entries(props).map(([key, value]) => ({ key, value: value as never, occurrence: 1, complex: false })),
});

describe('columns', () => {
  it('defaults to Title, the properties the query asks about (at most four, in order), then Updated', () => {
    expect(defaultColumns(parseQuery('prop:status=draft prop:rating=4 prop:status'))).toEqual(['title', 'prop:status', 'prop:rating', 'updated']);
    expect(defaultColumns(parseQuery('prop:a prop:b prop:c prop:d prop:e'))).toEqual(['title', 'prop:a', 'prop:b', 'prop:c', 'prop:d', 'updated']);
    expect(defaultColumns(parseQuery('due:week'))).toEqual(['title', 'updated']);
  });

  it('keeps Title first whatever the view says, and takes the default when the view names none', () => {
    expect(columnsOf({ columns: ['prop:x', 'title', 'updated'] }, parseQuery(''))).toEqual(['title', 'prop:x', 'updated']);
    expect(columnsOf({}, parseQuery('prop:k'))).toEqual(['title', 'prop:k', 'updated']);
  });

  it('shows the first four properties on a card, never Title or Updated', () => {
    expect(cardColumns(['title', 'prop:a', 'updated', 'prop:b', 'prop:c', 'prop:d', 'prop:e'])).toEqual(['prop:a', 'prop:b', 'prop:c', 'prop:d']);
  });
});

describe('cells', () => {
  const n = note('n1', '# Plan\n\nwords', { status: 'draft', rating: 4, done: true, tags: ['a', 'b'], empty: '' }, 1700000000000);

  it('reads the title, the edit time and each property, and knows what is missing', () => {
    expect(cellOf(n, 'title')).toEqual({ kind: 'title', text: 'Plan' });
    expect(cellOf(n, 'updated')).toEqual({ kind: 'updated', at: 1700000000000 });
    expect(cellOf(n, 'prop:rating')).toEqual({ kind: 'prop', value: 4, complex: false });
    expect(cellOf(n, 'prop:nope')).toEqual({ kind: 'missing' });
  });

  it('writes a value as YAML would, and puts an empty string in quotes for editing', () => {
    expect(cellText(cellOf(n, 'prop:tags'))).toBe('[a, b]');
    expect(cellText(cellOf(n, 'prop:done'))).toBe('true');
    expect(cellText(cellOf(n, 'prop:nope'))).toBe('');
    expect(editText(cellOf(n, 'prop:empty'))).toBe('""');
    expect(editText(cellOf(n, 'prop:status'))).toBe('draft');
  });

  it('picks a checkbox for a boolean, a number field for a number, words for the rest', () => {
    expect(editorKind(cellOf(n, 'prop:done'))).toBe('boolean');
    expect(editorKind(cellOf(n, 'prop:rating'))).toBe('number');
    expect(editorKind(cellOf(n, 'prop:status'))).toBe('text');
    expect(editorKind(cellOf(n, 'prop:tags'))).toBe('text');
    expect(editorKind(cellOf(n, 'prop:nope'))).toBe('text');
  });

  it('reads typed values: nothing removes, quotes and null are explicit, lists split at flow commas only, mappings are refused', () => {
    expect(parseCellInput('  ')).toEqual({ kind: 'remove' });
    expect(parseCellInput('""')).toEqual({ kind: 'set', value: '' });
    expect(parseCellInput('null')).toEqual({ kind: 'set', value: null });
    expect(parseCellInput('7')).toEqual({ kind: 'set', value: 7 });
    expect(parseCellInput('yes')).toEqual({ kind: 'set', value: 'yes' });
    expect(parseCellInput('red, blue')).toEqual({ kind: 'set', value: 'red, blue' });
    expect(parseCellInput('[red, "a, b", 3, true]')).toEqual({ kind: 'set', value: ['red', 'a, b', 3, true] });
    expect(parseCellInput('[]')).toEqual({ kind: 'set', value: [] });
    expect(parseCellInput('[a, b')).toEqual({ kind: 'error', message: 'A list needs its closing bracket' });
    expect(parseCellInput('{a: 1}').kind).toBe('error');
    expect(parseCellInput('["open').kind).toBe('error');
  });
});

describe('order', () => {
  const a = note('a', 'A', { n: 10, s: 'beta' });
  const b = note('b', 'B', { n: 9, s: 'Alpha' });
  const c = note('c', 'C', { s: 'gamma' });
  const d = note('d', 'D', { n: null });

  it('compares numbers as numbers, text as text, missing last either way, ties by id', () => {
    expect(sortNotes([a, b, c], { sortBy: 'prop:n' }).map((n) => n.id)).toEqual(['b', 'a', 'c']);
    expect(sortNotes([a, b, c], { sortBy: 'prop:n', sortDir: 'desc' }).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(sortNotes([a, b, c], { sortBy: 'prop:s' }).map((n) => n.id)).toEqual(['b', 'a', 'c']);
    expect(sortNotes([a, d, c], { sortBy: 'prop:n' }).map((n) => n.id)).toEqual(['a', 'c', 'd']);
    expect(compareNotes(c, d, 'prop:n', 'asc')).toBeLessThan(0);
  });

  it('keeps the query order without a sort', () => {
    expect(sortNotes([c, a, b], {}).map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('groups by a property, ascending, lists by their whole value, the rest under No value last', () => {
    const t1 = note('t1', 'x', { tags: ['a', 'b'] });
    const t2 = note('t2', 'x', { tags: ['a', 'b'] });
    const t3 = note('t3', 'x', { tags: 'zed' });
    const t4 = note('t4', 'x', {});
    const t5 = note('t5', 'x', { tags: '' });
    const groups = groupNotes([t3, t4, t1, t5, t2], { groupBy: 'prop:tags' });
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ['[a, b]', ['t1', 't2']],
      ['zed', ['t3']],
      ['No value', ['t4', 't5']],
    ]);
    expect(groupNotes([a, b], {}).map((g) => g.label)).toEqual(['']);
  });

  it('turns a header click into ascending, then descending, and Query order into none', () => {
    const once = withSortClick({}, 'prop:n');
    expect(once).toEqual({ sortBy: 'prop:n' });
    expect(withSortClick(once, 'prop:n')).toEqual({ sortBy: 'prop:n', sortDir: 'desc' });
    expect(withSortClick({ sortBy: 'prop:n', sortDir: 'desc' }, 'prop:n')).toEqual({ sortBy: 'prop:n' });
    expect(withSortClick({ sortBy: 'prop:n', sortDir: 'desc' }, 'title')).toEqual({ sortBy: 'title' });
    expect(withSortClick({ sortBy: 'prop:n', groupBy: 'prop:s' }, null)).toEqual({ groupBy: 'prop:s' });
  });
});

describe('words', () => {
  it('labels a tab with the name, else the query cut short', () => {
    expect(viewTabLabel('Due', 'due:week todo:')).toBe('Due');
    expect(viewTabLabel(undefined, 'due:week todo:')).toBe('due:week todo:');
    expect(viewTabLabel(undefined, 'a very long query that goes on and on forever')).toBe('a very long query that goes…');
  });

  it('finds the first line of words for a card', () => {
    expect(firstLine('# Title\n\n---\n\nThe words.')).toBe('Title');
    expect(firstLine('\n\n- a task')).toBe('- a task');
    expect(firstLine('')).toBe('');
  });
});
