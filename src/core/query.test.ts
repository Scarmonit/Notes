// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { applyFilter, EMPTY_FILTER, parseSort, parseTerms, parseWhen } from './query';
import { resolveNote } from './resolve';

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({ id, body, createdAt: 1000, updatedAt: 2000, ...extra });

const notes: Note[] = [
  note('aaaa1111', 'Shopping\n\n- [ ] milk #home', { updatedAt: 5000 }),
  note('bbbb2222', 'See [[Shopping]] #wow/commands', { title: 'Plan', updatedAt: 4000, pinned: true }),
  note('cccc3333', 'Nothing links here', { updatedAt: 3000, createdAt: 3000 }),
  note('dddd4444', 'Shop talk', { updatedAt: 1000 }),
];

describe('parseTerms', () => {
  it('sorts words into terms, exclusions and tags', () => {
    expect(parseTerms(['milk', '-eggs', '#Home', 'a phrase'])).toEqual({ terms: ['milk', 'a phrase'], excludes: ['eggs'], tags: ['home'] });
  });
});

describe('parseWhen', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  it('understands spans, days and dates', () => {
    expect(parseWhen('2h', now)).toBe(now - 2 * 3600 * 1000);
    expect(parseWhen('7d', now)).toBe(now - 7 * 86400 * 1000);
    expect(parseWhen('2026-01-02', now)).toBe(Date.parse('2026-01-02'));
    expect(parseWhen('nonsense', now)).toBeNull();
  });
});

describe('parseSort', () => {
  it('takes a key and a direction', () => {
    expect(parseSort('title-')).toEqual({ sort: 'title', reverse: true });
    expect(parseSort('words')).toEqual({ sort: 'words', reverse: false });
    expect(parseSort('size')).toBeNull();
  });
});

describe('applyFilter', () => {
  it('keeps the app order without a sort: pinned first, then newest', () => {
    expect(applyFilter(notes, EMPTY_FILTER).map((n) => n.id)).toEqual(['bbbb2222', 'aaaa1111', 'cccc3333', 'dddd4444']);
  });
  it('matches terms against title and body, excludes, and follows nested tags', () => {
    expect(applyFilter(notes, { ...EMPTY_FILTER, terms: ['shop'] }).map((n) => n.id)).toEqual(['bbbb2222', 'aaaa1111', 'dddd4444']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, terms: ['shop'], excludes: ['talk'] }).map((n) => n.id)).toEqual(['bbbb2222', 'aaaa1111']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, tags: ['wow'] }).map((n) => n.id)).toEqual(['bbbb2222']);
  });
  it('filters by links, orphans, tasks, pins and dates', () => {
    expect(applyFilter(notes, { ...EMPTY_FILTER, linksTo: 'aaaa1111' }).map((n) => n.id)).toEqual(['bbbb2222']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, linkedFrom: 'bbbb2222' }).map((n) => n.id)).toEqual(['aaaa1111']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, orphan: true }).map((n) => n.id)).toEqual(['cccc3333', 'dddd4444']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, hasTasks: true }).map((n) => n.id)).toEqual(['aaaa1111']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, pinned: false }).map((n) => n.id)).toEqual(['aaaa1111', 'cccc3333', 'dddd4444']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, createdAfter: 2000 }).map((n) => n.id)).toEqual(['cccc3333']);
  });
  it('sorts and limits', () => {
    expect(applyFilter(notes, { ...EMPTY_FILTER, sort: 'title' }).map((n) => n.id)).toEqual(['cccc3333', 'bbbb2222', 'dddd4444', 'aaaa1111']);
    expect(applyFilter(notes, { ...EMPTY_FILTER, sort: 'updated', reverse: true, limit: 2 }).map((n) => n.id)).toEqual(['dddd4444', 'cccc3333']);
  });
});

describe('resolveNote', () => {
  it('resolves ids, id prefixes, exact titles, title prefixes and fuzzy words in that order', () => {
    expect(resolveNote(notes, 'bbbb2222')).toMatchObject({ kind: 'one', note: { id: 'bbbb2222' } });
    expect(resolveNote(notes, 'cccc')).toMatchObject({ kind: 'one', note: { id: 'cccc3333' } });
    expect(resolveNote(notes, 'plan')).toMatchObject({ kind: 'one', note: { id: 'bbbb2222' } });
    expect(resolveNote(notes, 'shopping')).toMatchObject({ kind: 'one', note: { id: 'aaaa1111' } });
    expect(resolveNote(notes, 'shopp')).toMatchObject({ kind: 'one', note: { id: 'aaaa1111' } });
    expect(resolveNote(notes, 'shop')).toMatchObject({ kind: 'many' });
    expect(resolveNote(notes, 'Shopping.md')).toMatchObject({ kind: 'one', note: { id: 'aaaa1111' } });
    expect(resolveNote(notes, 'nothing here')).toMatchObject({ kind: 'one', note: { id: 'cccc3333' } });
    expect(resolveNote(notes, 'zzz')).toEqual({ kind: 'none' });
  });
});
