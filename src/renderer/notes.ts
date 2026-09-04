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

/** The note a link points at: the one whose title it names, or nothing. */
export function noteForLink(notes: Note[], target: string): Note | null {
  const want = linkKey(target);
  return notes.find((n) => linkKey(titleOf(n)) === want) ?? null;
}

/** The notes that link to this one, in the list's own order. */
export function backlinksOf(notes: Note[], id: string): Note[] {
  const note = notes.find((n) => n.id === id);
  if (!note) return [];
  const title = linkKey(titleOf(note));
  return notes.filter((n) => n.id !== id && linksIn(n.body).some((t) => linkKey(t) === title));
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
    const hay = `${n.title ?? ''}\n${n.body}`.toLowerCase();
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
