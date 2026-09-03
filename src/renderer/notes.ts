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
function plain(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
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
  return (first && plain(first)) || 'Untitled';
}

/** The body after the title line (or all of it when the title is explicit), collapsed, for the sidebar row. */
export function snippetOf(note: Pick<Note, 'body' | 'title'>, max = 90): string {
  const rest = lines(note.body)
    .slice(note.title?.trim() ? 0 : 1)
    .map(plain)
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
// letter so "#1" and "#123" stay plain text, and never "# Heading".
const TAG = /(?:^|(?<=\s))#(\p{L}[\p{L}\p{N}_-]*)/gu;

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
    if (tag && !tags.includes(tag)) return false;
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
