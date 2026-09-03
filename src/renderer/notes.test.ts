import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import {
  createNote,
  neighborOf,
  removeNote,
  searchNotes,
  snippetOf,
  sortByEdited,
  titleOf,
  updateBody,
  wordCount,
} from './notes';

describe('wordCount', () => {
  it('counts words and ignores markdown markers', () => {
    expect(wordCount('# Groceries\n\n- milk\n- eggs')).toBe(3);
  });
  it('keeps contractions together and handles empty text', () => {
    expect(wordCount("don't stop")).toBe(2);
    expect(wordCount('')).toBe(0);
    expect(wordCount('---\n***')).toBe(0);
  });
  it('does not count link or image targets', () => {
    expect(wordCount('see [the site](https://example.com/a/b) now')).toBe(4);
    expect(wordCount('![garden photo](note-asset://deadbeef.png)')).toBe(2);
  });
});

describe('titleOf with links and images', () => {
  it('uses alt and link text instead of URLs', () => {
    expect(titleOf({ body: '![Garden photo](note-asset://deadbeef.png)' })).toBe('Garden photo');
    expect(titleOf({ body: '[Docs](https://example.com) to read' })).toBe('Docs to read');
  });
});

const note = (id: string, body: string, updatedAt: number): Note => ({ id, body, createdAt: updatedAt, updatedAt });

describe('titleOf', () => {
  it('uses the first non-empty line', () => {
    expect(titleOf({ body: '\n\nGroceries\nmilk' })).toBe('Groceries');
  });
  it('strips heading, list and emphasis markers', () => {
    expect(titleOf({ body: '## **Plan** for _today_' })).toBe('Plan for today');
    expect(titleOf({ body: '- first item' })).toBe('first item');
    expect(titleOf({ body: '1. numbered' })).toBe('numbered');
  });
  it('falls back to Untitled', () => {
    expect(titleOf({ body: '' })).toBe('Untitled');
    expect(titleOf({ body: '   \n  ' })).toBe('Untitled');
    expect(titleOf({ body: '###' })).toBe('Untitled');
  });
});

describe('snippetOf', () => {
  it('skips the title line and joins the rest', () => {
    expect(snippetOf({ body: 'Title\n\n- milk\n- eggs' })).toBe('milk eggs');
  });
  it('is empty for a one-line note', () => {
    expect(snippetOf({ body: 'Just a title' })).toBe('');
  });
  it('truncates with an ellipsis', () => {
    const s = snippetOf({ body: `T\n${'word '.repeat(40)}` }, 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('sortByEdited', () => {
  it('puts the most recently edited first without mutating', () => {
    const list = [note('a', '', 1), note('b', '', 3), note('c', '', 2)];
    expect(sortByEdited(list).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(list.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('searchNotes', () => {
  const list = [note('a', 'Buy Milk and eggs', 1), note('b', 'Meeting notes\nmilk the process', 2), note('c', 'Nothing here', 3)];
  it('returns everything for an empty query', () => {
    expect(searchNotes(list, '')).toBe(list);
    expect(searchNotes(list, '   ')).toBe(list);
  });
  it('matches case-insensitively anywhere in the body', () => {
    expect(searchNotes(list, 'MILK').map((n) => n.id)).toEqual(['a', 'b']);
  });
  it('requires every term', () => {
    expect(searchNotes(list, 'milk eggs').map((n) => n.id)).toEqual(['a']);
    expect(searchNotes(list, 'milk zebra')).toEqual([]);
  });
});

describe('updateBody', () => {
  it('replaces the body and bumps updatedAt', () => {
    const out = updateBody([note('a', 'old', 1)], 'a', 'new', 99);
    expect(out[0]).toMatchObject({ body: 'new', updatedAt: 99 });
  });
  it('leaves the timestamp alone when nothing changed', () => {
    const out = updateBody([note('a', 'same', 1)], 'a', 'same', 99);
    expect(out[0].updatedAt).toBe(1);
  });
  it('does not touch other notes', () => {
    const out = updateBody([note('a', 'x', 1), note('b', 'y', 2)], 'a', 'z', 9);
    expect(out[1]).toEqual(note('b', 'y', 2));
  });
});

describe('removeNote / neighborOf', () => {
  const list = [note('a', '', 3), note('b', '', 2), note('c', '', 1)];
  it('removes by id', () => {
    expect(removeNote(list, 'b').map((n) => n.id)).toEqual(['a', 'c']);
  });
  it('prefers the next note down, then the one above, then nothing', () => {
    expect(neighborOf(list, 'a')).toBe('b');
    expect(neighborOf(list, 'c')).toBe('b');
    expect(neighborOf([list[0]], 'a')).toBeNull();
  });
  it('falls back to the first visible note when the id is not shown', () => {
    expect(neighborOf(list, 'zzz')).toBe('a');
    expect(neighborOf([], 'zzz')).toBeNull();
  });
});

describe('createNote', () => {
  it('has a unique id and equal timestamps', () => {
    const a = createNote(5);
    const b = createNote(5);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ body: '', createdAt: 5, updatedAt: 5 });
  });
});
