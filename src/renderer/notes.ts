import type { Note } from '../shared/types';

/** Pure operations on the in-memory note list. The UI in main.ts calls these. */

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createNote(now = Date.now()): Note {
  return { id: newId(), body: '', createdAt: now, updatedAt: now };
}

function lines(body: string): string[] {
  return body.split('\n').filter((l) => l.trim().length > 0);
}

/** Strip leading markdown block markers and inline emphasis so the list reads as plain text. */
function plain(line: string): string {
  return line
    .replace(/^[\s#>*\-+]+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function titleOf(note: Pick<Note, 'body'>): string {
  const first = lines(note.body)[0];
  return (first && plain(first)) || 'Untitled';
}

/** The line after the title, collapsed, for the sidebar row. */
export function snippetOf(note: Pick<Note, 'body'>, max = 90): string {
  const rest = lines(note.body)
    .slice(1)
    .map(plain)
    .filter(Boolean)
    .join(' ');
  return rest.length > max ? `${rest.slice(0, max - 1).trimEnd()}…` : rest;
}

/** Words are runs of letters or digits, so markdown markers like "#" and "-" do not count. */
export function wordCount(body: string): number {
  const words = body.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

export function sortByEdited(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/** Every whitespace-separated term must appear somewhere in the note, case-insensitively. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return notes;
  return notes.filter((n) => {
    const hay = n.body.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
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
