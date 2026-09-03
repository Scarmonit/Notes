import type { Note, NotesFile } from './types';

export const EMPTY_FILE: NotesFile = { version: 1, notes: [] };

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    n.id.length > 0 &&
    typeof n.body === 'string' &&
    typeof n.createdAt === 'number' &&
    Number.isFinite(n.createdAt) &&
    typeof n.updatedAt === 'number' &&
    Number.isFinite(n.updatedAt)
  );
}

/**
 * Parses the JSON text of notes.json. Throws when the document itself is not a
 * notes file; individual malformed entries are dropped so one bad record
 * cannot take every other note with it.
 */
export function parseNotesFile(text: string): NotesFile {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('notes file is not an object');
  const doc = raw as Record<string, unknown>;
  if (doc.version !== 1) throw new Error(`unsupported notes file version ${String(doc.version)}`);
  if (!Array.isArray(doc.notes)) throw new Error('notes file has no notes array');
  const seen = new Set<string>();
  const notes: Note[] = [];
  for (const entry of doc.notes) {
    if (!isNote(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const note: Note = { id: entry.id, body: entry.body, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    if ((entry as { pinned?: unknown }).pinned === true) note.pinned = true;
    notes.push(note);
  }
  return { version: 1, notes };
}
