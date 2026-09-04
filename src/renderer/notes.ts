import { FOLDER_SEP, folderKey, joinFolder, normalizeFolder, ROOT_FOLDER } from '../shared/folders';
import { cleanAliases } from '../shared/notes-folder';
import type { Note } from '../shared/types';

/** Pure operations on the in-memory note list. The UI in main.ts calls these. */

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createNote(now = Date.now(), body = ''): Note {
  return { id: newId(), body, createdAt: now, updatedAt: now };
}

function lines(body: string): string[] {
  return body.split('\n').filter((l) => l.trim().length > 0);
}

/** Strip leading markdown block markers and inline emphasis so the list reads as plain text. */
export function plainText(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(LINK, '$1')
    .replace(/<img\b[^<>]*\balt\s*=\s*"([^"]*)"[^<>]*>/gi, '$1')
    .replace(/<img\b[^<>]*>/gi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[\s#>*\-+]+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

/** The explicit title, else the first line of the body, else "Untitled". */
export function titleOf(note: Pick<Note, 'body' | 'title'>): string {
  const explicit = note.title?.trim();
  if (explicit) return explicit;
  const first = lines(note.body)[0];
  return (first && plainText(first)) || 'Untitled';
}

/** The body after the title line (or all of it when the title is explicit), collapsed, for the sidebar row. */
export function snippetOf(note: Pick<Note, 'body' | 'title'>, max = 90): string {
  const rest = lines(note.body)
    .slice(note.title?.trim() ? 0 : 1)
    .map(plainText)
    .filter(Boolean)
    .join(' ');
  return rest.length > max ? `${rest.slice(0, max - 1).trimEnd()}…` : rest;
}

/** Words are runs of letters or digits, so markdown markers like "#" and "-" do not count. */
export function wordCount(body: string): number {
  // Link and image targets are not prose.
  const prose = body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/<img\b[^<>]*\balt\s*=\s*"([^"]*)"[^<>]*>/gi, ' $1 ')
    .replace(/<img\b[^<>]*>/gi, ' ')
    .replace(/\]\([^)]*\)/g, ']');
  const words = prose.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

/** Pinned notes first, then most recently edited. */
export function sortByEdited(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

/** Pins or unpins one note. The edit time is untouched: pinning is not writing. */
export function togglePin(notes: Note[], id: string): Note[] {
  return notes.map((n) => {
    if (n.id !== id) return n;
    const { pinned, ...rest } = n;
    return pinned ? rest : { ...rest, pinned: true };
  });
}

// A tag is #word at the start of a line or after whitespace, starting with a
// letter so "#1" and "#123" stay plain text, and never "# Heading". A tag can
// be nested with slashes — #wow/commands — and each part must be there, so a
// trailing slash is simply not part of the tag.
const TAG = /(?:^|(?<=\s))#(\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu;

/** Where one tag sits under another: #wow/commands lives under #wow. */
export const TAG_SEP = '/';

/** A tag and the tags it is nested inside, outermost first: wow, wow/commands. */
export function tagPath(tag: string): string[] {
  const parts = tag.split(TAG_SEP);
  return parts.map((_, i) => parts.slice(0, i + 1).join(TAG_SEP));
}

/** True when `tag` is `under`, or nested inside it. */
export function tagMatches(tag: string, under: string): boolean {
  return tag === under || tag.startsWith(`${under}${TAG_SEP}`);
}

/** The tags written in a note, lower-cased, unique, in order of appearance. */
export function tagsOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Every tag across the notes with how many notes carry it, most used first. */
export function allTags(notes: Note[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of tagsOf(n.body)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface TagNode {
  /** The whole tag: wow/commands. */
  tag: string;
  /** Just this level of it: commands. */
  label: string;
  /** Notes carrying this tag or anything nested inside it. */
  count: number;
  children: TagNode[];
}

/**
 * The tags as a tree. A note tagged #wow/commands counts towards #wow as well,
 * because that is what filing something under a heading means — otherwise the
 * parent would read as empty while everything sat inside it.
 */
export function tagTree(notes: Note[]): TagNode[] {
  const counts = new Map<string, number>();
  const written = new Set<string>();
  for (const n of notes) {
    const reached = new Set<string>();
    for (const tag of tagsOf(n.body)) {
      written.add(tag);
      // Every level of the path, but each counted once per note.
      for (const step of tagPath(tag)) reached.add(step);
    }
    for (const step of reached) counts.set(step, (counts.get(step) ?? 0) + 1);
  }
  const nodes = new Map<string, TagNode>();
  for (const tag of counts.keys()) {
    const parts = tag.split(TAG_SEP);
    nodes.set(tag, { tag, label: parts[parts.length - 1], count: counts.get(tag) ?? 0, children: [] });
  }
  const roots: TagNode[] = [];
  for (const [tag, node] of nodes) {
    const parent = tag.includes(TAG_SEP) ? nodes.get(tag.slice(0, tag.lastIndexOf(TAG_SEP))) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: TagNode, b: TagNode): number => b.count - a.count || a.tag.localeCompare(b.tag);
  const sortDeep = (list: TagNode[]): TagNode[] => {
    list.sort(order);
    for (const node of list) sortDeep(node.children);
    return list;
  };
  return sortDeep(roots);
}

// A wikilink: [[Another note]], the title of the note it points at. Shared
// with richeditor.ts, which needs it inside its one pass over the body, and
// markdown.ts, which renders it in the preview.
export const LINK_PATTERN = '\\[\\[([^\\[\\]\\n]+)\\]\\]';
const LINK = new RegExp(LINK_PATTERN, 'g');

/** How a link's target is compared: by title, ignoring case and stray spaces. */
export const linkKey = (target: string): string => target.trim().toLowerCase();

/**
 * The inside of a link taken apart: `[[Target|shown as this]]` points at
 * Target and reads as the alias, the way Obsidian writes it. Everything that
 * follows, lists, renders or rewrites a link agrees on this one split.
 */
export function linkParts(inner: string): { target: string; alias?: string } {
  const bar = inner.indexOf('|');
  if (bar < 0) return { target: inner.trim() };
  const alias = inner.slice(bar + 1).trim();
  return alias ? { target: inner.slice(0, bar).trim(), alias } : { target: inner.slice(0, bar).trim() };
}

/** The titles a note links to, in order of appearance, without repeats. */
export function linksIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK)) {
    const { target } = linkParts(m[1]);
    if (target && !out.some((t) => linkKey(t) === linkKey(target))) out.push(target);
  }
  return out;
}

/** The markdown for a link to a note title, shown as its alias when it has one. */
export const linkMarkdown = (target: string, alias?: string): string => `[[${target.trim()}${alias?.trim() ? `|${alias.trim()}` : ''}]]`;

/**
 * Every name a note answers to: its title first, then its aliases. A link, a
 * search or the command line naming any of them means this note.
 */
export function namesOf(note: Pick<Note, 'body' | 'title' | 'aliases'>): string[] {
  return [titleOf(note), ...(note.aliases ?? [])].filter((n) => n.trim());
}

/** True when one of the note's names is what a link is asking for. */
export function answersTo(note: Pick<Note, 'body' | 'title' | 'aliases'>, target: string): boolean {
  const want = linkKey(target);
  return namesOf(note).some((n) => linkKey(n) === want);
}

/** What a [[link]] found: one note, none, or more than one and no way to choose. */
export type LinkHit = { kind: 'one'; note: Note } | { kind: 'none' } | { kind: 'many'; notes: Note[] };

/** The notes answering to a name, title first: an alias never shadows a title. */
function answering(notes: Note[], name: string): Note[] {
  const want = linkKey(name);
  const titled = notes.filter((n) => linkKey(titleOf(n)) === want);
  return titled.length > 0 ? titled : notes.filter((n) => (n.aliases ?? []).some((a) => linkKey(a) === want));
}

/**
 * Where a [[link]] points, and how sure it is.
 *
 * Folders make two notes called Plan legal, so a bare `[[Plan]]` can no longer
 * always mean one of them. When it names more than one, the link is ambiguous
 * and lands nowhere: choosing the first, or the nearest, would make what a link
 * means depend on where the notes happen to sit and which order they were read.
 *
 * A slash makes it a path instead: `[[Work/Plan]]` is the note called Plan in
 * the folder Work. A title with a slash in it is still a title, so the whole
 * name is tried first and the path reading only steps in when nothing answers.
 */
export function resolveLink(notes: Note[], target: string): LinkHit {
  const raw = target.trim();
  const settle = (hits: Note[]): LinkHit | null => (hits.length === 1 ? { kind: 'one', note: hits[0] } : hits.length > 1 ? { kind: 'many', notes: hits } : null);
  const at = raw.lastIndexOf(FOLDER_SEP);
  if (at > 0) {
    const folder = normalizeFolder(raw.slice(0, at));
    const name = raw.slice(at + 1).replace(/.md$/i, '');
    const here = notes.filter((n) => folderKey(n.folder ?? ROOT_FOLDER) === folderKey(folder));
    const found = settle(answering(here, name));
    if (found) return found;
  }
  return settle(answering(notes, raw)) ?? { kind: 'none' };
}

/**
 * The note a link points at: the one whose title it names, or failing that
 * the one that lists the name as an alias. Title beats alias, always, so a
 * note cannot be shadowed by another note's nickname for something. A name
 * more than one note answers to points nowhere until it is said which.
 */
export function noteForLink(notes: Note[], target: string): Note | null {
  const hit = resolveLink(notes, target);
  return hit.kind === 'one' ? hit.note : null;
}

/** How a link would have to be written to mean this note and no other. */
export function qualifiedLink(notes: Note[], note: Note): string {
  const title = titleOf(note);
  const hit = resolveLink(notes, title);
  if (hit.kind === 'one' && hit.note.id === note.id) return title;
  return joinFolder(note.folder ?? ROOT_FOLDER, title);
}

/**
 * The notes that link to this one — by its title or by any name it answers
 * to — in the list's own order. A link counts only when it would actually
 * land here, so what the strip lists and what a click follows agree; the
 * answer for each distinct target is worked out once.
 */
export function backlinksOf(notes: Note[], id: string): Note[] {
  if (!notes.some((n) => n.id === id)) return [];
  const landed = new Map<string, string | null>();
  const pointsHere = (target: string): boolean => {
    const key = linkKey(target);
    if (!landed.has(key)) landed.set(key, noteForLink(notes, target)?.id ?? null);
    return landed.get(key) === id;
  };
  return notes.filter((n) => n.id !== id && linksIn(n.body).some(pointsHere));
}

/** Sets or clears the other names a note answers to. */
export function updateAliases(notes: Note[], id: string, aliases: string[], now = Date.now()): Note[] {
  const clean = cleanAliases(aliases);
  return notes.map((n) => {
    if (n.id !== id) return n;
    if ((n.aliases ?? []).join('\u0000') === clean.join('\u0000')) return n;
    const { aliases: _old, ...rest } = n;
    return clean.length > 0 ? { ...rest, aliases: clean, updatedAt: now } : { ...rest, updatedAt: now };
  });
}

/**
 * Every whitespace-separated term must appear somewhere in the note,
 * case-insensitively. A term written as #name matches only notes tagged with
 * something that starts with it, and `tag` narrows to notes carrying exactly it.
 */
export function searchNotes(notes: Note[], query: string, tag: string | null = null): Note[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0 && !tag) return notes;
  return notes.filter((n) => {
    const tags = tagsOf(n.body);
    // A parent tag stands for everything filed under it, so #wow finds
    // #wow/commands as well.
    if (tag && !tags.some((t) => tagMatches(t, tag))) return false;
    const hay = `${n.title ?? ''}\n${(n.aliases ?? []).join('\n')}\n${n.body}`.toLowerCase();
    return terms.every((t) => (t.length > 1 && t.startsWith('#') ? tags.some((x) => x.startsWith(t.slice(1))) : hay.includes(t)));
  });
}

/** Sets or clears the explicit title of one note. A blank title means "use the first line". */
export function updateTitle(notes: Note[], id: string, title: string, now = Date.now()): Note[] {
  const clean = title.trim();
  return notes.map((n) => {
    if (n.id !== id || (n.title ?? '') === clean) return n;
    const { title: _old, ...rest } = n;
    return clean ? { ...rest, title: clean, updatedAt: now } : { ...rest, updatedAt: now };
  });
}

/** What leaves the app on export: the explicit title as a heading above the body. */
export function exportBody(note: Pick<Note, 'body' | 'title'>): string {
  const explicit = note.title?.trim();
  return explicit ? `# ${explicit}\n\n${note.body}` : note.body;
}

/** Replaces the body of one note; untouched when the text is identical so the timestamp holds. */
export function updateBody(notes: Note[], id: string, body: string, now = Date.now()): Note[] {
  return notes.map((n) => (n.id === id && n.body !== body ? { ...n, body, updatedAt: now } : n));
}

export function removeNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}

/**
 * Which note should be selected once `id` leaves the visible list: the one
 * below it, else the one above, else nothing.
 */
export function neighborOf(visible: Note[], id: string): string | null {
  const i = visible.findIndex((n) => n.id === id);
  if (i < 0) return visible[0]?.id ?? null;
  return (visible[i + 1] ?? visible[i - 1])?.id ?? null;
}
