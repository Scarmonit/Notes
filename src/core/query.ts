import { linkKey, linksIn, tagMatches, tagsOf, titleOf, wordCount } from '../renderer/notes';
import { tasksIn } from '../renderer/tasks';
import { folderMatches, parseFolder, ROOT_FOLDER } from '../shared/folders';
import { parseTyped, propertyHas, type PropertyScalar } from '../shared/properties';
import type { Note } from '../shared/types';
import { addDays, inWindow, parseDueWindow, type DueWindow } from './due';

/**
 * One filter grammar for every command that takes a set of notes, so
 * `notes list`, `notes search`, `notes delete` and `notes export` all narrow
 * the notes the same way and the same words mean the same thing in each —
 * and, since 0.13, the search box in the window reads the same grammar.
 *
 * Bare words are terms every note must contain (case-insensitively, as the
 * app's search box); `-word` excludes; a word with spaces is a phrase;
 * `#tag` keeps notes carrying that tag or anything nested under it. The
 * flags add what words cannot say: dates, pins, links, tasks, order. The
 * same things can be written as operators inside the query — `tag:wow`,
 * `todo:`, `created:>7d`, `due:today`, `/regex/`, `sort:title` — which is
 * what `parseQuery` reads.
 */

export type SortKey = 'updated' | 'created' | 'title' | 'words';

export interface Filter {
  terms: string[];
  excludes: string[];
  tags: string[];
  /** Tags a note must not carry: `-tag:wow`. */
  excludeTags?: string[];
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
  /** The same two, by title: what the search box can say. */
  linksToTitle?: string;
  linkedFromTitle?: string;
  /**
   * The folder a note must be in, or beneath: `folder:Work` finds `Work` and
   * everything under it, the way `tag:work` finds `#work/clients`. `/` asks
   * for the notes filed at the root itself.
   */
  folder?: string;
  /**
   * Front-matter properties a note must carry: `prop:status` wants the key at
   * all, `prop:status=draft` wants that value. Each entry is one `prop:`
   * written in the query, and every one of them must be satisfied.
   */
  props?: PropFilter[];
  /** The same, said with a leading `-`: none of these may hold. */
  excludeProps?: PropFilter[];
  /** Notes nothing links to and that link to nothing. */
  orphan?: boolean;
  hasTasks?: boolean;
  /** Notes with at least one unticked task, or at least one ticked one. */
  hasTodo?: boolean;
  hasDone?: boolean;
  /** Notes with an undone dated task in this window. */
  due?: DueWindow;
  /** Every pattern must match the title or the body. */
  patterns?: RegExp[];
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
  if (s === 'yesterday') return addDays(startOfDay(now), -1);
  const span = /^(\d+(?:\.\d+)?)\s*([mhdwy])$/.exec(s);
  if (span) return now - Number(span[1]) * UNIT_MS[span[2]];
  if (/^\d+$/.test(s)) {
    // Milliseconds are the one bare number the grammar takes; a shorter one
    // (`created:>5`) is a slip, not the year 2001 Date.parse would make of it.
    return s.length >= 12 ? Number(s) : null;
  }
  // A bare date is that day here, as every other date in the grammar is; Date.parse would make it UTC midnight.
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
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

// --- the operators ------------------------------------------------------------

/** The operators the query grammar knows, for the help sheet and completion. */
export const OPERATORS: Array<{ op: string; means: string }> = [
  { op: 'tag:wow', means: 'carrying #wow (or anything nested under it); #wow says the same' },
  { op: '-word', means: 'without the word' },
  { op: '"a phrase"', means: 'the words together, in that order' },
  { op: '/pattern/i', means: 'matching a regular expression' },
  { op: 'todo:', means: 'with an unticked task (done: a ticked one, task: any)' },
  { op: 'due:today', means: 'with a task due by then: today, tomorrow, week, 7d, overdue, any, a date' },
  { op: 'pinned:', means: 'pinned (pinned:no for the rest)' },
  { op: 'untitled:', means: 'without an explicit title' },
  { op: 'created:>7d', means: 'made in the last week; < for before, a date or a span (updated: likewise)' },
  { op: 'links:Title', means: 'linking to that note (from:Title for the notes it links to)' },
  { op: 'folder:Work', means: 'in this folder or one beneath it; folder:/ for the ones at the root' },
  { op: 'prop:status=draft', means: 'with that front-matter key, or that key holding that value' },
  { op: 'orphan:', means: 'with no links either way' },
  { op: 'sort:title', means: 'ordered by title, created, updated or words; add - to reverse' },
  { op: 'limit:5', means: 'at most that many' },
];

/**
 * Whether a query needs the grammar: an operator, a pattern, a "quoted
 * phrase" or a -word. Plain words and #tags are the search box's own.
 */
export function hasOperators(text: string): boolean {
  return tokenize(text).some((t) => t.kind !== 'word' || t.quoted || (t.text.length > 1 && t.text.startsWith('-')));
}

interface Token {
  kind: 'word' | 'op' | 'regex';
  text: string;
  /** For ops: the part after the colon. */
  value: string;
  /** A word that was written in quotes: a phrase. */
  quoted?: boolean;
}

/**
 * Splits a query on spaces, keeping "quoted phrases", `op:"quoted values"`
 * and `/regular expressions/` whole. A colon inside a word makes it an
 * operator only when what comes before it is a known operator name, so
 * `10:30` and `http://` stay words.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const s = text.trim();
  let i = 0;
  const readQuoted = (): string => {
    // At an opening quote: everything up to the closing one, or the end.
    const end = s.indexOf('"', i + 1);
    const inner = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end);
    i = end < 0 ? s.length : end + 1;
    return inner;
  };
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === '"') {
      const phrase = readQuoted();
      if (phrase.trim()) out.push({ kind: 'word', text: phrase, value: '', quoted: true });
      continue;
    }
    if (s[i] === '/') {
      const close = s.indexOf('/', i + 1);
      if (close > i + 1) {
        let j = close + 1;
        while (j < s.length && /[a-z]/i.test(s[j])) j++;
        if (j >= s.length || /\s/.test(s[j])) {
          out.push({ kind: 'regex', text: s.slice(i + 1, close), value: s.slice(close + 1, j) });
          i = j;
          continue;
        }
      }
    }
    const op = /^(-?)([a-z]+):/i.exec(s.slice(i));
    if (op && OPERATOR_NAMES.has(op[2].toLowerCase())) {
      i += op[0].length;
      let value: string;
      if (s[i] === '"') value = readQuoted();
      else {
        const end = s.slice(i).search(/\s/);
        value = end < 0 ? s.slice(i) : s.slice(i, i + end);
        i = end < 0 ? s.length : i + end;
      }
      out.push({ kind: 'op', text: `${op[1]}${op[2].toLowerCase()}`, value });
      continue;
    }
    const end = s.slice(i).search(/\s/);
    const word = end < 0 ? s.slice(i) : s.slice(i, i + end);
    i = end < 0 ? s.length : i + end;
    out.push({ kind: 'word', text: word, value: '' });
  }
  return out;
}

const OPERATOR_NAMES = new Set(['tag', 'todo', 'done', 'task', 'tasks', 'due', 'pinned', 'pin', 'untitled', 'created', 'updated', 'edited', 'links', 'from', 'linked', 'orphan', 'folder', 'prop', 'sort', 'limit']);

const yes = (v: string): boolean => !/^(no|false|off|0)$/i.test(v.trim());

/** The operators a leading `-` can say no to. */
const NEGATABLE = new Set(['tag', 'todo', 'done', 'task', 'tasks', 'pinned', 'pin', 'untitled', 'prop']);

/** A `>7d` / `<2026-01-01` / `7d` bound as after/before moments. */
function bounds(value: string, now: number): { after?: number; before?: number } | null {
  const m = /^([<>]?)=?(.+)$/.exec(value.trim());
  if (!m) return null;
  const t = parseWhen(m[2], now);
  if (t === null) return null;
  // `created:2026-01-01` means that day; `created:7d` means since then.
  if (m[1] === '<') return { before: t };
  if (m[1] === '>') return { after: t };
  return /^\d{4}-\d{2}-\d{2}$/.test(m[2].trim()) ? { after: t, before: addDays(t, 1) - 1 } : { after: t };
}

/**
 * The filter a query describes. Anything unreadable — a bad regex, a date
 * that is not one — is reported in `errors` and otherwise ignored, so the
 * list never goes empty for a half-typed operator.
 */
export function parseQuery(text: string, now = Date.now()): Filter & { errors: string[] } {
  const filter: Filter & { errors: string[] } = { ...EMPTY_FILTER, terms: [], excludes: [], tags: [], errors: [] };
  for (const tok of tokenize(text)) {
    if (tok.kind === 'word') {
      const w = tok.text;
      if (w.length > 1 && w.startsWith('#')) filter.tags.push(w.slice(1).toLowerCase());
      else if (w.length > 1 && w.startsWith('-')) filter.excludes.push(w.slice(1).toLowerCase());
      else filter.terms.push(w.toLowerCase());
      continue;
    }
    if (tok.kind === 'regex') {
      try {
        // A global or sticky flag would carry lastIndex from one note to the next.
        const flags = tok.value.replace(/[gy]/g, '');
        (filter.patterns ??= []).push(new RegExp(tok.text, flags.includes('i') ? flags : `${flags}i`));
      } catch {
        filter.errors.push(`/${tok.text}/ is not a valid pattern`);
      }
      continue;
    }
    const negate = tok.text.startsWith('-');
    const name = negate ? tok.text.slice(1) : tok.text;
    const v = tok.value.trim();
    if (negate && !NEGATABLE.has(name)) {
      filter.errors.push(`-${name}: cannot be turned around; only tag, todo, done, task, pinned, untitled and prop can`);
      continue;
    }
    switch (name) {
      case 'tag':
        if (v) (negate ? (filter.excludeTags ??= []) : filter.tags).push(v.replace(/^#/, '').toLowerCase());
        break;
      case 'todo':
        filter.hasTodo = negate ? !yes(v) : yes(v);
        break;
      case 'done':
        filter.hasDone = negate ? !yes(v) : yes(v);
        break;
      case 'task':
      case 'tasks':
        filter.hasTasks = negate ? !yes(v) : yes(v);
        break;
      case 'pinned':
      case 'pin':
        filter.pinned = negate ? !yes(v) : yes(v);
        break;
      case 'untitled':
        filter.untitled = negate ? !yes(v) : yes(v);
        break;
      case 'orphan':
        filter.orphan = yes(v);
        break;
      case 'prop': {
        const parsed = parseProp(v);
        if (!parsed) filter.errors.push(`prop: wants a key, or key=value; not "${v}"`);
        else if (negate) (filter.excludeProps ??= []).push(parsed);
        else (filter.props ??= []).push(parsed);
        break;
      }
      case 'folder': {
        const parsed = parseFolder(v === '/' ? '' : v);
        if ('error' in parsed) filter.errors.push(`folder: ${parsed.error}`);
        // A bare folder: is no question at all; / is the question "at the root".
        else if (v) filter.folder = v === '/' ? ROOT_ONLY : parsed.folder;
        break;
      }
      case 'due': {
        const w = parseDueWindow(v, now);
        if (w) filter.due = w;
        else filter.errors.push(`due: wants today, tomorrow, week, 7d, overdue, any or a date; not "${v}"`);
        break;
      }
      case 'created':
      case 'updated':
      case 'edited': {
        const b = bounds(v, now);
        if (!b) {
          filter.errors.push(`${name}: wants a date or a span such as >7d; not "${v}"`);
          break;
        }
        if (name === 'created') {
          if (b.after !== undefined) filter.createdAfter = b.after;
          if (b.before !== undefined) filter.createdBefore = b.before;
        } else {
          if (b.after !== undefined) filter.updatedAfter = b.after;
          if (b.before !== undefined) filter.updatedBefore = b.before;
        }
        break;
      }
      case 'links':
        if (v) filter.linksToTitle = v;
        break;
      case 'from':
      case 'linked':
        if (v) filter.linkedFromTitle = v;
        break;
      case 'sort': {
        const s = parseSort(v);
        if (s) {
          filter.sort = s.sort;
          filter.reverse = s.reverse;
        } else filter.errors.push(`sort: wants one of ${SORT_KEYS.join(', ')}; not "${v}"`);
        break;
      }
      case 'limit': {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) filter.limit = n;
        else filter.errors.push(`limit: wants a number; not "${v}"`);
        break;
      }
    }
  }
  return filter;
}

// --- applying a filter ------------------------------------------------------------

/** One `prop:` question: a key, and the value it must hold when one was given. */
export interface PropFilter {
  key: string;
  /** Absent means "has this key at all, whatever it says". */
  value?: PropertyScalar;
}

/**
 * A `prop:` operand read as a key and an optional value.
 *
 * A comparison the app cannot answer — `rating>3` — is refused rather than
 * taken for a key spelled with a `>` in it, so the search says what it cannot
 * do instead of quietly finding nothing.
 */
export function parseProp(operand: string): PropFilter | null {
  const said = operand.trim();
  if (!said) return null;
  const at = said.indexOf('=');
  const key = (at < 0 ? said : said.slice(0, at)).trim();
  if (!key || /[<>!~]/.test(key)) return null;
  return at < 0 ? { key } : { key, value: parseTyped(said.slice(at + 1)) };
}

/** Whether a note answers one `prop:` question. */
function hasProp(note: Note, want: PropFilter): boolean {
  const found = (note.properties ?? []).filter((p) => p.key === want.key);
  if (found.length === 0) return false;
  // Any occurrence will do: a key written twice is two answers to the question.
  return want.value === undefined || found.some((p) => propertyHas(p, want.value as PropertyScalar));
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
/**
 * The value `folder:/` stands for: the root and nothing beneath it. The root
 * as a folder is the empty string, which would mean the whole notebook, so
 * asking for the root alone needs a word of its own.
 */
export const ROOT_ONLY = '/';

/** Whether a note is in a folder, or in one inside it. */
export function inFolder(note: Note, folder: string): boolean {
  const at = note.folder ?? ROOT_FOLDER;
  return folder === ROOT_ONLY ? at === ROOT_FOLDER : folderMatches(at, folder);
}

export function applyFilter(notes: Note[], filter: Filter): Note[] {
  const byTitle = (title: string | undefined): Note | undefined => (title ? notes.find((n) => linkKey(titleOf(n)) === linkKey(title)) : undefined);
  const linkTarget = filter.linksTo ? notes.find((n) => n.id === filter.linksTo) : byTitle(filter.linksToTitle);
  const linkSource = filter.linkedFrom ? notes.find((n) => n.id === filter.linkedFrom) : byTitle(filter.linkedFromTitle);
  const wantsTarget = Boolean(filter.linksTo || filter.linksToTitle);
  const wantsSource = Boolean(filter.linkedFrom || filter.linkedFromTitle);
  const targetKey = linkTarget ? linkKey(titleOf(linkTarget)) : null;
  const sourceLinks = linkSource ? linksIn(linkSource.body).map(linkKey) : null;
  const linkedTitles = filter.orphan ? new Set(notes.flatMap((n) => linksIn(n.body).map(linkKey))) : null;

  let out = notes.filter((n) => {
    if (!matchesTerms(n, filter.terms, filter.excludes)) return false;
    if (filter.patterns && !filter.patterns.every((re) => re.test(`${titleOf(n)}\n${n.body}`))) return false;
    if (filter.tags.some((tag) => !hasTag(n, tag))) return false;
    if (filter.folder !== undefined && !inFolder(n, filter.folder)) return false;
    if (filter.props?.some((want) => !hasProp(n, want))) return false;
    if (filter.excludeProps?.some((want) => hasProp(n, want))) return false;
    if (filter.excludeTags?.some((tag) => hasTag(n, tag))) return false;
    if (filter.pinned !== undefined && (n.pinned === true) !== filter.pinned) return false;
    if (filter.untitled !== undefined && Boolean(n.title?.trim()) === filter.untitled) return false;
    if (filter.createdAfter !== undefined && n.createdAt < filter.createdAfter) return false;
    if (filter.createdBefore !== undefined && n.createdAt > filter.createdBefore) return false;
    if (filter.updatedAfter !== undefined && n.updatedAt < filter.updatedAfter) return false;
    if (filter.updatedBefore !== undefined && n.updatedAt > filter.updatedBefore) return false;
    if (targetKey !== null && (n.id === linkTarget?.id || !linksIn(n.body).some((t) => linkKey(t) === targetKey))) return false;
    if (wantsTarget && !linkTarget) return false;
    if (sourceLinks !== null && (n.id === linkSource?.id || !sourceLinks.includes(linkKey(titleOf(n))))) return false;
    if (wantsSource && !linkSource) return false;
    if (linkedTitles && (linkedTitles.has(linkKey(titleOf(n))) || linksIn(n.body).length > 0)) return false;
    if (filter.hasTasks !== undefined || filter.hasTodo !== undefined || filter.hasDone !== undefined || filter.due) {
      const tasks = tasksIn(n.body);
      if (filter.hasTasks !== undefined && (tasks.length > 0) !== filter.hasTasks) return false;
      if (filter.hasTodo !== undefined && tasks.some((t) => !t.done) !== filter.hasTodo) return false;
      if (filter.hasDone !== undefined && tasks.some((t) => t.done) !== filter.hasDone) return false;
      if (filter.due && !tasks.some((t) => !t.done && t.due !== undefined && inWindow({ due: t.due }, filter.due as DueWindow))) return false;
    }
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

/**
 * The words of a command line as a filter. Each argument is its own token,
 * as the shell already split them: `todo:` is an operator, `links:My note`
 * (one quoted argument) is an operator with a value that has a space in
 * it, and anything else is a term, an exclusion or a tag.
 */
export function parseWords(words: readonly string[], now = Date.now()): Filter & { errors: string[] } {
  const merged: Filter & { errors: string[] } = { ...EMPTY_FILTER, terms: [], excludes: [], tags: [], errors: [] };
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const op = /^(-?[a-z]+):([\s\S]*)$/i.exec(word);
    const isOp = op && OPERATOR_NAMES.has(op[1].replace(/^-/, '').toLowerCase());
    const isRegex = /^\/.+\/[a-z]*$/i.test(word);
    if (!isOp && !isRegex) {
      const plain = parseTerms([word]);
      merged.terms.push(...plain.terms);
      merged.excludes.push(...plain.excludes);
      merged.tags.push(...plain.tags);
      continue;
    }
    const one = parseQuery(isOp ? `${op[1]}:"${op[2].replace(/"/g, '')}"` : word, now);
    merged.terms.push(...one.terms);
    merged.excludes.push(...one.excludes);
    merged.tags.push(...one.tags);
    merged.errors.push(...one.errors);
    if (one.patterns) (merged.patterns ??= []).push(...one.patterns);
    if (one.excludeTags) (merged.excludeTags ??= []).push(...one.excludeTags);
    if (one.props) (merged.props ??= []).push(...one.props);
    if (one.excludeProps) (merged.excludeProps ??= []).push(...one.excludeProps);
    for (const key of ['pinned', 'untitled', 'createdAfter', 'createdBefore', 'updatedAfter', 'updatedBefore', 'linksToTitle', 'linkedFromTitle', 'orphan', 'folder', 'hasTasks', 'hasTodo', 'hasDone', 'due', 'sort', 'reverse', 'limit'] as const) {
      if (one[key] !== undefined) (merged as unknown as Record<string, unknown>)[key] = one[key];
    }
  }
  return merged;
}
