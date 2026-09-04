// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { applyFilter, EMPTY_FILTER, hasOperators, parseQuery, parseSort, parseTerms, parseWhen, parseWords } from './query';
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
    // A bare date is that day in local time, like every other date the grammar reads.
    expect(parseWhen('2026-01-02', now)).toBe(new Date(2026, 0, 2).getTime());
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

describe('parseQuery (the search box grammar)', () => {
  const now = Date.parse('2026-09-03T12:00:00');
  it('reads words, tags, phrases, exclusions and regexes', () => {
    const f = parseQuery('milk -eggs #Home "a phrase" /sh?op/ tag:wow', now);
    expect(f).toMatchObject({ terms: ['milk', 'a phrase'], excludes: ['eggs'], tags: ['home', 'wow'], errors: [] });
    expect(f.patterns?.[0].source).toBe('sh?op');
    expect(f.patterns?.[0].flags).toContain('i');
    expect(hasOperators('milk #home')).toBe(false);
    expect(hasOperators('todo:')).toBe(true);
    expect(hasOperators('meet at 10:30')).toBe(false);
    // The legend under the search box promises these two, so they must not
    // fall through to the plain-word matcher, which knows neither.
    expect(hasOperators('milk -eggs')).toBe(true);
    expect(hasOperators('"a phrase"')).toBe(true);
    expect(hasOperators('a - b')).toBe(false);
  });
  it('reads the task, pin, date, link, sort and limit operators', () => {
    expect(parseQuery('todo: done:no pinned: untitled:no orphan: sort:title- limit:5', now)).toMatchObject({
      hasTodo: true,
      hasDone: false,
      pinned: true,
      untitled: false,
      orphan: true,
      sort: 'title',
      reverse: true,
      limit: 5,
    });
    expect(parseQuery('-todo: pinned:no task:', now)).toMatchObject({ hasTodo: false, pinned: false, hasTasks: true });
    expect(parseQuery('created:>7d updated:<2026-01-01', now)).toMatchObject({ createdAfter: now - 7 * 86400 * 1000, updatedBefore: new Date(2026, 0, 1).getTime() });
    expect(parseQuery('created:2026-01-02', now)).toMatchObject({ createdAfter: new Date(2026, 0, 2).getTime(), createdBefore: new Date(2026, 0, 3).getTime() - 1 });
    // A short bare number is a slip, not a date: Date.parse would make `5` the year 2001.
    expect(parseQuery('created:>5', now).createdAfter).toBeUndefined();
    expect(parseQuery('links:"My plan" from:Shopping', now)).toMatchObject({ linksToTitle: 'My plan', linkedFromTitle: 'Shopping' });
    expect(parseQuery('due:today', now).due).toEqual({ until: new Date(2026, 8, 3, 23, 59, 59, 999).getTime() });
  });
  it('reports what it cannot read and keeps going', () => {
    const f = parseQuery('due:soon sort:size limit:x /(/ ok', now);
    expect(f.terms).toEqual(['ok']);
    expect(f.errors).toHaveLength(4);
  });
});

describe('applyFilter with the new operators', () => {
  const dated = [
    ...notes,
    note('eeee5555', '- [ ] rent @2026-09-03\n- [x] done', { title: 'Bills', updatedAt: 6000 }),
  ];
  const now = Date.parse('2026-09-03T12:00:00');
  it('matches todo, done, due windows, patterns and link titles', () => {
    expect(applyFilter(dated, parseQuery('todo:', now)).map((n) => n.id)).toEqual(['eeee5555', 'aaaa1111']);
    expect(applyFilter(dated, parseQuery('done:', now)).map((n) => n.id)).toEqual(['eeee5555']);
    expect(applyFilter(dated, parseQuery('todo:no task:', now)).map((n) => n.id)).toEqual([]);
    expect(applyFilter(dated, parseQuery('due:today', now)).map((n) => n.id)).toEqual(['eeee5555']);
    expect(applyFilter(dated, parseQuery('due:tomorrow', now)).map((n) => n.id)).toEqual([]);
    expect(applyFilter(dated, parseQuery('/^shop/', now)).map((n) => n.id)).toEqual(['aaaa1111', 'dddd4444']);
    expect(applyFilter(dated, parseQuery('links:shopping', now)).map((n) => n.id)).toEqual(['bbbb2222']);
    expect(applyFilter(dated, parseQuery('from:plan', now)).map((n) => n.id)).toEqual(['aaaa1111']);
    expect(applyFilter(dated, parseQuery('links:nothing-named-this', now))).toEqual([]);
  });
});

describe('parseWords (command-line arguments)', () => {
  it('keeps each argument whole and reads operators inside them', () => {
    const f = parseWords(['milk', '-eggs', '#home', 'a phrase', 'todo:', 'links:My plan', '/sh?op/', 'sort:title'], Date.parse('2026-09-03T12:00:00'));
    expect(f).toMatchObject({ terms: ['milk', 'a phrase'], excludes: ['eggs'], tags: ['home'], hasTodo: true, linksToTitle: 'My plan', sort: 'title', errors: [] });
    expect(f.patterns?.[0].source).toBe('sh?op');
    expect(parseWords(['10:30', 'http://x']).terms).toEqual(['10:30', 'http://x']);
  });
});

describe('0.13.1 regressions', () => {
  const now = Date.parse('2026-09-03T12:00:00');
  const note = (id: string, body: string): Note => ({ id, body, createdAt: 1, updatedAt: 1 });
  it('drops a global or sticky flag from /pattern/g, which would skip every other note', () => {
    const notes = [note('a', 'plan a'), note('b', 'plan b'), note('c', 'plan c')];
    expect(applyFilter(notes, parseQuery('/plan/g', now)).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(parseQuery('/plan/gi', now).patterns?.[0].flags).toBe('i');
  });
  it('reads -tag:x as "without that tag" and refuses a - on an operator that has no opposite', () => {
    const notes = [note('a', 'x #work'), note('b', 'x #home'), note('c', 'x #work/deep')];
    const f = parseQuery('-tag:work', now);
    expect(f.tags).toEqual([]);
    expect(f.excludeTags).toEqual(['work']);
    expect(applyFilter(notes, f).map((n) => n.id)).toEqual(['b']);
    expect(parseWords(['-tag:work'], now).excludeTags).toEqual(['work']);
    expect(parseQuery('-due:today', now).errors[0]).toMatch(/^-due: cannot/);
    expect(parseQuery('-sort:title', now).sort).toBeUndefined();
  });
});
