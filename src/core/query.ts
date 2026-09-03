import { linkKey, linksIn, tagMatches, tagsOf, titleOf, wordCount } from '../renderer/notes';
import { tasksIn } from '../renderer/tasks';
import type { Note } from '../shared/types';

/**
 * One filter grammar for every command that takes a set of notes, so
 * `notes list`, `notes search`, `notes delete` and `notes export` all narrow
 * the notes the same way and the same words mean the same thing in each.
 *
 * Bare words are terms every note must contain (case-insensitively, as the
 * app's search box); `-word` excludes; a word with spaces is a phrase;
 * `#tag` keeps notes carrying that tag or anything nested under it. The
 * flags add what words cannot say: dates, pins, links, tasks, order.
 */

export type SortKey = 'updated' | 'created' | 'title' | 'words';

export interface Filter {
  terms: string[];
  excludes: string[];
  tags: string[];
  pinned?: boolean;
  untitled?: boolean;
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
  /** Notes that link to this note (by id). */
  linksTo?: string;
  /** Notes this note links to (by id). */
  linkedFrom?: string;
  /** Notes nothing links to and that link to nothing. */
  orphan?: boolean;
  hasTasks?: boolean;
  sort?: SortKey;
  /** Reverse the natural direction of the sort. */
  reverse?: boolean;
  limit?: number;
}

export const EMPTY_FILTER: Filter = { terms: [], excludes: [], tags: [] };

/** The words of a query, sorted into terms, exclusions and tags. */
export function parseTerms(words: readonly string[]): Pick<Filter, 'terms' | 'excludes' | 'tags'> {
  const out: Pick<Filter, 'terms' | 'excludes' | 'tags'> = { terms: [], excludes: [], tags: [] };
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    if (word.length > 1 && word.startsWith('#')) out.tags.push(word.slice(1).toLowerCase());
    else if (word.length > 1 && word.startsWith('-')) out.excludes.push(word.slice(1).toLowerCase());
    else out.terms.push(word.toLowerCase());
  }
  return out;
}

const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

/**
 * A moment from the ways people write one: an ISO date or date-time,
 * `today`, `yesterday`, or a span ago such as `7d`, `2w`, `3h`, `30m`.
 * Null when it is none of those.
 */
export function parseWhen(text: string, now = Date.now()): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (s === 'now') return now;
  if (s === 'today') return startOfDay(now);
  if (s === 'yesterday') return startOfDay(now) - UNIT_MS.d;
  const span = /^(\d+(?:\.\d+)?)\s*([mhdwy])$/.exec(s);
  if (span) return now - Number(span[1]) * UNIT_MS[span[2]];
  if (/^\d+$/.test(s) && s.length >= 12) return Number(s);
  const t = Date.parse(text.trim());
  return Number.isFinite(t) ? t : null;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const SORT_KEYS: SortKey[] = ['updated', 'created', 'title', 'words'];

/** `updated`, `title-`, `words+`: a key with an optional direction. */
export function parseSort(text: string): { sort: SortKey; reverse: boolean } | null {
  const m = /^(updated|created|title|words)([-+]?)$/i.exec(text.trim());
  if (!m) return null;
  return { sort: m[1].toLowerCase() as SortKey, reverse: m[2] === '-' };
}

/** Whether a note carries a tag, or one nested inside it. */
const hasTag = (note: Note, tag: string): boolean => tagsOf(note.body).some((t) => tagMatches(t, tag));

/** Whether every term is somewhere in the note: its title or its body, case-insensitively. */
function matchesTerms(note: Note, terms: string[], excludes: string[]): boolean {
  const hay = `${titleOf(note)}\n${note.title ?? ''}\n${note.body}`.toLowerCase();
  return terms.every((t) => hay.includes(t)) && !excludes.some((t) => hay.includes(t));
}

const compare: Record<SortKey, (a: Note, b: Note) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  words: (a, b) => wordCount(b.body) - wordCount(a.body),
};

/**
 * The notes a filter keeps, in its order. Without a sort the list is the
 * app's own: pinned first, then most recently edited.
 */
export function applyFilter(notes: Note[], filter: Filter): Note[] {
  const linkTarget = filter.linksTo ? notes.find((n) => n.id === filter.linksTo) : undefined;
  const linkSource = filter.linkedFrom ? notes.find((n) => n.id === filter.linkedFrom) : undefined;
  const targetKey = linkTarget ? linkKey(titleOf(linkTarget)) : null;
  const sourceLinks = linkSource ? linksIn(linkSource.body).map(linkKey) : null;
  const linkedTitles = filter.orphan ? new Set(notes.flatMap((n) => linksIn(n.body).map(linkKey))) : null;

  let out = notes.filter((n) => {
    if (!matchesTerms(n, filter.terms, filter.excludes)) return false;
    if (filter.tags.some((tag) => !hasTag(n, tag))) return false;
    if (filter.pinned !== undefined && (n.pinned === true) !== filter.pinned) return false;
    if (filter.untitled !== undefined && Boolean(n.title?.trim()) === filter.untitled) return false;
    if (filter.createdAfter !== undefined && n.createdAt < filter.createdAfter) return false;
    if (filter.createdBefore !== undefined && n.createdAt > filter.createdBefore) return false;
    if (filter.updatedAfter !== undefined && n.updatedAt < filter.updatedAfter) return false;
    if (filter.updatedBefore !== undefined && n.updatedAt > filter.updatedBefore) return false;
    if (targetKey !== null && (n.id === linkTarget?.id || !linksIn(n.body).some((t) => linkKey(t) === targetKey))) return false;
    if (filter.linksTo && !linkTarget) return false;
    if (sourceLinks !== null && (n.id === linkSource?.id || !sourceLinks.includes(linkKey(titleOf(n))))) return false;
    if (filter.linkedFrom && !linkSource) return false;
    if (linkedTitles && (linkedTitles.has(linkKey(titleOf(n))) || linksIn(n.body).length > 0)) return false;
    if (filter.hasTasks !== undefined && (tasksIn(n.body).length > 0) !== filter.hasTasks) return false;
    return true;
  });

  if (filter.sort) {
    out = [...out].sort(compare[filter.sort]);
    if (filter.reverse) out.reverse();
  } else {
    out = [...out].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    if (filter.reverse) out.reverse();
  }
  if (filter.limit !== undefined && filter.limit >= 0) out = out.slice(0, filter.limit);
  return out;
}
