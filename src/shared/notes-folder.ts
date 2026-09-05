import type { NoteProperty, PropertyScalar, PropertyValue } from './properties';
import { parseScalar, unquote, writeProperty } from './properties';
import type { Note } from './types';

/**
 * Notes as a folder of markdown files, one per note, each with a small
 * front-matter block carrying what the filename and the text cannot: the
 * note's id, its explicit title, when it was made and last changed, and
 * whether it is pinned.
 *
 * The rules for reading and writing one file live here, away from the
 * filesystem, so they can be tested on their own. What comes out of
 * parseNoteFile is exactly a Note; what goes into formatNoteFile is exactly a
 * Note; and a file that has passed through both is the same file.
 *
 * A file without front matter — one dropped into the folder by hand, or made
 * by another program — is still a note: its title is its filename and its
 * dates are the file's own. It gets front matter the first time it is written.
 */

/** What is known about a file before its text is read. */
export interface FileFacts {
  /** The id to use when the file does not carry one. */
  id: string;
  /** The filename without its extension, which is the title when there is no other. */
  name: string;
  /** The file's modification time, for a file with no dates of its own. */
  mtime: number;
}

/**
 * One item of front matter, in the order it was written.
 *
 * This is a *span*, not a parsed field: `source` is the lines exactly as they
 * appeared, and an entry nobody touched is written back byte for byte. That
 * is what lets a note pass through this app and come out differing only where
 * the person asked it to — including the order the keys stand in, which is
 * somebody's file and not this app's to tidy.
 *
 * An entry with no `key` and no `owned` is a comment or something that is not
 * `key: value` at all. An entry with a key and `complex` is YAML the app can
 * show but not edit — a nested mapping, a block scalar, an anchor.
 */
export interface FrontMatterEntry {
  /** The key, for a `key: value` line; absent for a comment or a stray line. */
  key?: string;
  /**
   * A field the app owns, named here only so it keeps the place it had. Its
   * value is written from the note, never from `source`.
   */
  owned?: string;
  /** The lines as written. Rewritten only when this entry itself changed. */
  source: string[];
  /** What the value is worth, when the app can read and write it. */
  value?: PropertyValue;
  /** True when the value is beyond what the app edits. */
  complex?: boolean;
}

const KNOWN = new Set(['id', 'title', 'created', 'updated', 'pinned', 'deleted']);

/** Keys whose value may be a YAML list, written on the line or indented under it. */
const LISTS = new Set(['aliases']);

/** The keys this app owns. A properties editor shows them but never writes them as YAML. */
export const RESERVED = new Set([...KNOWN, ...LISTS]);

export interface ParsedNoteFile {
  note: Note;
  /** Front matter the app does not own, in order, kept so it survives a rewrite. */
  frontMatter: FrontMatterEntry[];
  /** True when the file had no front matter, or was missing its id: it should be written back. */
  needsWrite: boolean;
  /** When the file is in the trash: the moment it was deleted. */
  deletedAt?: number;
}

/** The properties the rest of the app reads, numbered by occurrence in file order. */
export function propertiesOf(entries: readonly FrontMatterEntry[]): NoteProperty[] {
  const seen = new Map<string, number>();
  const out: NoteProperty[] = [];
  for (const entry of entries) {
    if (entry.key === undefined || entry.owned !== undefined) continue;
    const occurrence = (seen.get(entry.key) ?? 0) + 1;
    seen.set(entry.key, occurrence);
    out.push({ key: entry.key, value: entry.complex ? null : (entry.value ?? null), occurrence, complex: entry.complex === true });
  }
  return out;
}

/** True when a line belongs to the value above it rather than starting one of its own. */
const isContinuation = (line: string): boolean => /^[ \t]/.test(line) && line.trim() !== '';

/** A YAML value the app will not try to read: a block scalar, an anchor, a tag. */
const isComplexValue = (value: string): boolean => /^[|>&*!]/.test(value);

/**
 * The lines under a `key:` with nothing on its own line, read as a list when
 * every one of them is a plain `- item` and as complex when any is not.
 */
function readBlock(rows: readonly string[], from: number): { items: PropertyScalar[] | null; end: number } {
  const items: PropertyScalar[] = [];
  let i = from;
  let ok = true;
  for (; i < rows.length && isContinuation(rows[i]); i++) {
    const item = /^[ \t]+-[ \t]+(.*)$/.exec(rows[i]);
    // An item that is itself a mapping, or a nested key, is past what is edited here.
    if (!item || /^[A-Za-z_][\w-]*\s*:/.test(item[1].trim())) ok = false;
    else items.push(parseScalar(item[1].trim()));
  }
  return { items: ok && items.length > 0 ? items : null, end: i };
}

/**
 * The front-matter block at the top of a file, and the text after it.
 *
 * Lines that are not `key: value`, and keys the app does not know, are kept
 * as they were: front matter written by another program — Obsidian's, most
 * likely — must survive a rewrite untouched. The one exception is a list key
 * the app does know, whose indented `- item` lines belong to it rather than
 * to that pile.
 */
function splitFrontMatter(text: string): { fields: Map<string, string>; lists: Map<string, string[]>; entries: FrontMatterEntry[]; body: string } | null {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const fields = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const entries: FrontMatterEntry[] = [];
  const rows = m[1].split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const at = i;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv && LISTS.has(kv[1])) {
      const items = kv[2].trim() ? inlineList(kv[2].trim()) : [];
      // An empty value opens a block list: the indented `- item` lines below it.
      while (items.length === 0 || !kv[2].trim()) {
        const next = /^[ \t]*-[ \t]+(.*)$/.exec(rows[i + 1] ?? '');
        if (!next) break;
        i++;
        const item = unquote(next[1].trim());
        if (item) items.push(item);
      }
      lists.set(kv[1], items);
      entries.push({ owned: kv[1], source: rows.slice(at, i + 1) });
    } else if (kv && KNOWN.has(kv[1])) {
      fields.set(kv[1], kv[2].trim());
      entries.push({ owned: kv[1], source: [line] });
    }
    else if (kv) {
      // A key the app does not own: a property, kept as the lines it was
      // written on so an untouched one is written back exactly as it came.
      const value = kv[2].trim();
      const source = [line];
      let entry: FrontMatterEntry;
      if (!value) {
        const block = readBlock(rows, i + 1);
        source.push(...rows.slice(i + 1, block.end));
        i = block.end - 1;
        // `key:` with indented lines under it is a list when they all read as
        // items, and complex when they do not; with nothing under it, null.
        entry = block.items ? { key: kv[1], value: block.items, source } : source.length > 1 ? { key: kv[1], source, complex: true } : { key: kv[1], value: null, source };
      } else if (isComplexValue(value)) {
        while (isContinuation(rows[i + 1] ?? '')) source.push(rows[++i]);
        entry = { key: kv[1], source, complex: true };
      } else if (value.startsWith('{')) {
        entry = { key: kv[1], source, complex: true };
      } else if (value.startsWith('[')) {
        entry = { key: kv[1], value: inlineList(value).map(parseScalar), source };
      } else {
        entry = { key: kv[1], value: parseScalar(value), source };
      }
      entries.push(entry);
    } else if (isContinuation(line) && entries.length > 0) {
      // A stray indented line belongs to whatever came before it.
      entries[entries.length - 1].source.push(line);
      entries[entries.length - 1].complex = true;
      delete entries[entries.length - 1].value;
    } else if (line.trim()) entries.push({ source: [line] });
  }
  return { fields, lists, entries, body: text.slice(m[0].length) };
}

/** `[a, b]` or a bare `a, b`, as YAML writes a list on one line. */
function inlineList(value: string): string[] {
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return splitOutsideQuotes(inner)
    .map((part) => unquote(part.trim()))
    .filter(Boolean);
}

/** Splits on commas, leaving the ones inside a quoted item alone. */
function splitOutsideQuotes(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = '';
      // YAML only opens a quoted scalar at the start of an item. Taking one
      // mid-item swallowed every comma after an apostrophe, so `[Bob's plan,
      // Draft]` read as a single alias — and aliases are rewritten on save, so
      // the second name was then lost from the file for good.
    } else if ((c === '"' || c === "'") && text.slice(at, i).trim() === '') quote = c;
    else if (c === ',') {
      out.push(text.slice(at, i));
      at = i + 1;
    }
  }
  out.push(text.slice(at));
  return out;
}

/** The names a note answers to besides its title, cleaned of blanks and repeats. */
export function cleanAliases(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** A date written as ISO text, or as a number of milliseconds. Null when it is neither. */
function timeOf(value: string | undefined): number | null {
  if (!value) return null;
  // Past what a Date can hold (nanoseconds from another tool, say) is no
  // date: writing it back would throw, and every save formats every note.
  if (/^\d+$/.test(value)) return Number(value) <= MAX_TIME ? Number(value) : null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** The largest number of milliseconds a Date can stand for. */
const MAX_TIME = 8.64e15;

/**
 * Reads one note file. Never throws: every field has a fallback in the facts
 * about the file itself, so any text at all reads as some note.
 */
export function parseNoteFile(text: string, facts: FileFacts): ParsedNoteFile {
  // A BOM belongs to the file, not to the note. Left in place it hides the
  // `---` from the front-matter reader, so the whole block reads as body text
  // and the next save writes a second one above it.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const normalized = withoutBom.replace(/\r\n/g, '\n');
  const split = splitFrontMatter(normalized);
  // One trailing newline is the file's, added on write; the rest is the note's.
  const body = (split ? split.body : normalized).replace(/\n$/, '');
  const fields = split?.fields ?? new Map<string, string>();
  const id = fields.get('id')?.trim() || facts.id;
  const created = timeOf(fields.get('created')) ?? facts.mtime;
  const updated = timeOf(fields.get('updated')) ?? facts.mtime;
  const note: Note = { id, body, createdAt: created, updatedAt: updated };
  const explicit = fields.has('title') ? unquote(fields.get('title') ?? '').trim() : '';
  if (explicit) note.title = explicit;
  else if (!split && facts.name.trim()) note.title = facts.name.trim();
  if (fields.get('pinned') === 'true') note.pinned = true;
  const aliases = cleanAliases(split?.lists.get('aliases') ?? []);
  if (aliases.length > 0) note.aliases = aliases;
  const entries = split?.entries ?? [];
  const props = propertiesOf(entries);
  if (props.length > 0) note.properties = props;
  const out: ParsedNoteFile = { note, frontMatter: entries, needsWrite: !split || !fields.get('id')?.trim() };
  const deleted = timeOf(fields.get('deleted'));
  if (deleted !== null) out.deletedAt = deleted;
  return out;
}

const iso = (t: number): string => new Date(t).toISOString();

/**
 * The text of one note file: front matter, then the body, then one newline.
 *
 * The keys the app owns are written from the note. Everything else is written
 * from the entries it was read with, and an entry nobody changed is emitted
 * exactly as it arrived — there is no reserialization, no reordering and no
 * requoting of front matter this app did not put there.
 */
export function formatNoteFile(note: Note, frontMatter: readonly FrontMatterEntry[] = [], deletedAt?: number): string {
  const aliases = cleanAliases(note.aliases ?? []);
  // What each field the app owns is worth now, or null for one the note no
  // longer has. On one line and in brackets for aliases, which is how Obsidian
  // writes them and what every YAML reader understands.
  const owned: Record<string, string | null> = {
    id: `id: ${note.id}`,
    title: note.title?.trim() ? `title: ${JSON.stringify(note.title.trim())}` : null,
    aliases: aliases.length > 0 ? `aliases: [${aliases.map((a) => (/[,[\]"':#]/.test(a) ? JSON.stringify(a) : a)).join(', ')}]` : null,
    created: `created: ${iso(note.createdAt)}`,
    updated: `updated: ${iso(note.updatedAt)}`,
    pinned: note.pinned ? 'pinned: true' : null,
    deleted: deletedAt !== undefined ? `deleted: ${iso(deletedAt)}` : null,
  };
  const written = new Set<string>();
  const kept: string[] = [];
  for (const entry of frontMatter) {
    if (entry.owned === undefined) {
      kept.push(...entry.source);
      continue;
    }
    // A field the file already carried is written back where it stood.
    written.add(entry.owned);
    const line = owned[entry.owned];
    if (line !== null && line !== undefined) kept.push(line);
  }
  // Whatever the file did not have goes at the top, in the app's own order.
  const head = ORDER.filter((key) => !written.has(key))
    .map((key) => owned[key])
    .filter((line): line is string => line !== null);
  return `${['---', ...head, ...kept, '---'].join('\n')}\n${note.body}\n`;
}

/** The order the app writes its own fields in, for a file that did not have them. */
const ORDER = ['id', 'title', 'aliases', 'created', 'updated', 'pinned', 'deleted'];

/**
 * The front matter with one property changed, added or taken out.
 *
 * Only the named occurrence's own span is touched: a new key lands after the
 * last property there is, and everything else — comments, complex values,
 * the properties either side — comes through untouched. `occurrence` counts
 * from 1 among the entries carrying that key, because YAML lets a key appear
 * twice and this app refuses to guess which one was meant.
 */
export function withProperty(
  entries: readonly FrontMatterEntry[],
  key: string,
  value: PropertyValue | undefined,
  occurrence = 1,
): FrontMatterEntry[] {
  const out = [...entries];
  let nth = 0;
  let at = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].key !== key) continue;
    nth++;
    if (nth === occurrence) {
      at = i;
      break;
    }
  }
  if (value === undefined) {
    if (at >= 0) out.splice(at, 1);
    return out;
  }
  // A list keeps the shape it already had; a new one is written as items.
  const style = at >= 0 && out[at].source.length === 1 && Array.isArray(out[at].value) ? 'inline' : 'block';
  const made: FrontMatterEntry = { key, value, source: writeProperty(key, value, style) };
  if (at >= 0) out.splice(at, 1, made);
  else {
    // After the last property, and so before any trailing comment.
    let last = -1;
    for (let i = 0; i < out.length; i++) if (out[i].key !== undefined) last = i;
    out.splice(last + 1, 0, made);
  }
  return out;
}

/** The front matter with every occurrence of a key taken out. */
export const withoutProperty = (entries: readonly FrontMatterEntry[], key: string): FrontMatterEntry[] => entries.filter((e) => e.key !== key);

const MAX_NAME = 80;

/**
 * A filename for a title: the characters Windows allows, spaces kept, cut to
 * a sensible length. The id is not in the name — the name is for people, and
 * the front matter is what the app goes by.
 */
export function fileNameFor(title: string): string {
  const clean = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    // A file starting with a dot or a tilde is a hidden or a lock file to the store (isNoteFileName): it would never be read back.
    .replace(/^[.~\s]+/, '')
    .slice(0, MAX_NAME)
    .trim();
  // Names Windows reserves, whatever the extension.
  if (!clean || /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return 'Untitled';
  return clean;
}

/** `Name.md`, or `Name 2.md`, `Name 3.md`… until one is free. */
export function uniqueFileName(base: string, taken: (name: string) => boolean): string {
  const first = `${base}.md`;
  if (!taken(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}.md`;
    if (!taken(candidate)) return candidate;
  }
}

/** True when a directory entry is a note file rather than something else living in the folder. */
export function isNoteFileName(name: string): boolean {
  return /\.md$/i.test(name) && !name.startsWith('.') && !name.startsWith('~');
}
