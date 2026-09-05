import { titleOf } from '../renderer/notes';
import { parseScalar, typeOfValue, writeScalar, type NoteProperty, type PropertyScalar, type PropertyValue } from '../shared/properties';
import type { ViewPresentation } from '../shared/settings';
import type { Note } from '../shared/types';
import type { Filter } from './query';

/**
 * A saved search shown as a table or as cards: the notes it finds as rows,
 * their front-matter properties as columns. Everything here is arithmetic on
 * notes and strings — which columns, what a cell holds, how rows sort and
 * group, what a typed value means — so the window has only to draw it.
 *
 * A column is named `title`, `updated` or `prop:<key>`. The query is applied
 * whole first, `limit:` included; sorting and grouping are the view's own
 * and never change which notes it finds.
 */

export const TITLE_COLUMN = 'title';
export const UPDATED_COLUMN = 'updated';
export const PROP_PREFIX = 'prop:';

/** The most properties the default columns take from the query. */
const DEFAULT_PROPS = 4;

export const propColumn = (key: string): string => `${PROP_PREFIX}${key}`;
export const columnKey = (column: string): string | null => (column.startsWith(PROP_PREFIX) ? column.slice(PROP_PREFIX.length) : null);

/** What a column is called at the top of the table. */
export function columnLabel(column: string): string {
  if (column === TITLE_COLUMN) return 'Title';
  if (column === UPDATED_COLUMN) return 'Updated';
  return columnKey(column) ?? column;
}

/**
 * The columns when the view names none: Title, then up to four distinct
 * properties the query itself asks about (in the order it asks), then Updated.
 */
export function defaultColumns(filter: Pick<Filter, 'props'>): string[] {
  const keys: string[] = [];
  for (const p of filter.props ?? []) {
    if (!keys.includes(p.key)) keys.push(p.key);
    if (keys.length >= DEFAULT_PROPS) break;
  }
  return [TITLE_COLUMN, ...keys.map(propColumn), UPDATED_COLUMN];
}

/** The columns a view shows: its own, with Title first whatever they say; else the default. */
export function columnsOf(view: ViewPresentation, filter: Pick<Filter, 'props'>): string[] {
  const own = view.columns?.filter((c) => c !== TITLE_COLUMN) ?? [];
  return view.columns && view.columns.length > 0 ? [TITLE_COLUMN, ...own] : defaultColumns(filter);
}

/** What a cell holds: the title, the edit time in ms, a property's value, or null for a property the note lacks. */
export type Cell = { kind: 'title'; text: string } | { kind: 'updated'; at: number } | { kind: 'prop'; value: PropertyValue; complex: boolean } | { kind: 'missing' };

export function cellOf(note: Note, column: string): Cell {
  if (column === TITLE_COLUMN) return { kind: 'title', text: titleOf(note) };
  if (column === UPDATED_COLUMN) return { kind: 'updated', at: note.updatedAt };
  const key = columnKey(column);
  const prop = key === null ? undefined : (note.properties ?? []).find((p: NoteProperty) => p.key === key);
  if (!prop) return { kind: 'missing' };
  return { kind: 'prop', value: prop.value, complex: prop.complex === true };
}

/** A cell's words, for reading. */
export function cellText(cell: Cell): string {
  switch (cell.kind) {
    case 'title':
      return cell.text;
    case 'updated':
      return new Date(cell.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    case 'missing':
      return '';
    case 'prop':
      return valueText(cell.value);
  }
}

/** A value as YAML would write it inline: a list in flow style, a scalar as it is. */
export function valueText(value: PropertyValue): string {
  if (Array.isArray(value)) return `[${value.map(writeScalar).join(', ')}]`;
  if (value === null) return 'null';
  return typeof value === 'string' ? value : String(value);
}

/** The value put in a cell's editor: the words to edit, `null` spelled out, a list in flow style. */
export const editText = (cell: Cell): string => (cell.kind === 'prop' ? (cell.value === '' ? '""' : valueText(cell.value)) : '');

/** What a typed cell means. */
export type CellInput = { kind: 'set'; value: PropertyValue } | { kind: 'remove' } | { kind: 'error'; message: string };

/**
 * Reads what was typed into a cell. Nothing at all takes the key off the
 * note; `""` is an empty string and `null` is null, said explicitly; `[a, b]`
 * is a list, split only at the commas YAML flow style allows and never by
 * guesswork; a mapping is refused. Anything else is the scalar its shape says.
 */
export function parseCellInput(text: string): CellInput {
  const raw = text.trim();
  if (raw === '') return { kind: 'remove' };
  if (raw.startsWith('{')) return { kind: 'error', message: 'A nested mapping cannot be edited here; use Properties…' };
  if (raw.startsWith('[')) {
    if (!raw.endsWith(']')) return { kind: 'error', message: 'A list needs its closing bracket' };
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return { kind: 'set', value: [] };
    const items = splitFlow(inner);
    if (!items) return { kind: 'error', message: 'A quote in the list was not closed' };
    return { kind: 'set', value: items.map((item) => parseScalar(item.trim())) };
  }
  return { kind: 'set', value: parseScalar(raw) };
}

/** The items of a YAML flow list, split at commas outside quotes; null when a quote never closes. */
function splitFlow(inner: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (quote) return null;
  out.push(cur);
  return out.filter((s, i, all) => !(s.trim() === '' && i === all.length - 1));
}

/** How a cell edits: a box to tick, a number to type, or words. */
export function editorKind(cell: Cell): 'boolean' | 'number' | 'text' {
  if (cell.kind !== 'prop' || Array.isArray(cell.value)) return 'text';
  const type = typeOfValue(cell.value);
  return type === 'boolean' ? 'boolean' : type === 'number' ? 'number' : 'text';
}

/** The scalar a cell sorts by: a list by its first item, a missing or null value as nothing. */
function sortKey(cell: Cell): PropertyScalar | null {
  switch (cell.kind) {
    case 'title':
      return cell.text;
    case 'updated':
      return cell.at;
    case 'missing':
      return null;
    case 'prop': {
      const v = Array.isArray(cell.value) ? (cell.value[0] ?? null) : cell.value;
      return v === null || v === '' ? null : v;
    }
  }
}

/**
 * Two cells compared: numbers as numbers when both are, otherwise as text
 * with the notebook's own collation; a missing or null value comes last in
 * either direction, and a tie is broken by the note's id so the order holds.
 */
export function compareNotes(a: Note, b: Note, column: string, dir: 'asc' | 'desc'): number {
  const ka = sortKey(cellOf(a, column));
  const kb = sortKey(cellOf(b, column));
  if (ka === null && kb === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  let c: number;
  if (typeof ka === 'number' && typeof kb === 'number') c = ka - kb;
  else c = String(ka).localeCompare(String(kb), undefined, { sensitivity: 'base', numeric: true });
  if (c === 0) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return dir === 'desc' ? -c : c;
}

/** The notes in the view's order: the query's own, unless the view sorts by a column. */
export function sortNotes(notes: readonly Note[], view: ViewPresentation): Note[] {
  if (!view.sortBy) return [...notes];
  const column = view.sortBy;
  const dir = view.sortDir ?? 'asc';
  return [...notes].sort((a, b) => compareNotes(a, b, column, dir));
}

export interface NoteGroup {
  /** What the group is called: the value's words, or "No value". */
  label: string;
  notes: Note[];
}

export const NO_VALUE = 'No value';

/**
 * The notes grouped by a property: one group per distinct value (a list by
 * its whole value), ascending, with the notes that lack it last under
 * "No value". Without a grouping, one unnamed group.
 */
export function groupNotes(notes: readonly Note[], view: ViewPresentation): NoteGroup[] {
  const sorted = sortNotes(notes, view);
  if (!view.groupBy) return [{ label: '', notes: sorted }];
  const groups = new Map<string, Note[]>();
  const none: Note[] = [];
  for (const n of sorted) {
    const cell = cellOf(n, view.groupBy);
    const missing = cell.kind !== 'prop' || cell.value === null || cell.value === '' || (Array.isArray(cell.value) && cell.value.length === 0);
    if (missing) {
      none.push(n);
      continue;
    }
    const label = cellText(cell);
    const list = groups.get(label) ?? [];
    list.push(n);
    groups.set(label, list);
  }
  const out = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([label, list]) => ({ label, notes: list }));
  if (none.length > 0) out.push({ label: NO_VALUE, notes: none });
  return out;
}

/** The view with a header clicked: a new column sorts ascending, the same one flips, and Query order is `null`. */
export function withSortClick(view: ViewPresentation, column: string | null): ViewPresentation {
  const next: ViewPresentation = { ...view };
  delete next.sortBy;
  delete next.sortDir;
  if (column === null) return next;
  if (view.sortBy === column) {
    next.sortBy = column;
    if ((view.sortDir ?? 'asc') === 'asc') next.sortDir = 'desc';
  } else next.sortBy = column;
  return next;
}

/** The label of a tab for a view: its name, else the query itself, cut. */
export function viewTabLabel(name: string | undefined, query: string, max = 28): string {
  if (name) return name;
  const q = query.trim();
  return q.length > max ? `${q.slice(0, max - 1)}…` : q;
}

/** The property columns a card shows: the first four selected, Title and Updated apart. */
export function cardColumns(columns: readonly string[]): string[] {
  return columns.filter((c) => c !== TITLE_COLUMN && c !== UPDATED_COLUMN).slice(0, 4);
}

/** The first line of a body that is words, for the card's foot. */
export function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t && !/^---+$/.test(t)) return t;
  }
  return '';
}
