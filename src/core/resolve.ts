import { linkKey, titleOf } from '../renderer/notes';
import { folderKey, joinFolder, normalizeFolder, ROOT_FOLDER } from '../shared/folders';
import { fileNameFor } from '../shared/notes-folder';
import type { Note, TrashedNote } from '../shared/types';

/**
 * Which note someone means. A note can be named by its id (whole, or a
 * prefix no other id shares), its exact title (as `[[links]]` compare them),
 * a prefix of its title no other title shares, the filename it is stored
 * under, or, failing all of those, the words of its title in order. The
 * order is fixed so a script that worked yesterday works today: an exact
 * match is never beaten by a fuzzy one.
 */

export type Resolution<T> = { kind: 'one'; note: T } | { kind: 'none' } | { kind: 'many'; candidates: T[] };

interface Named {
  id: string;
  title: string;
}

/** The shortest id prefix that is accepted, so `a` cannot mean "the first note". */
const MIN_ID_PREFIX = 4;

function resolveNamed<T extends Named>(items: T[], selector: string): Resolution<T> {
  const raw = selector.trim();
  if (!raw) return { kind: 'none' };
  const want = linkKey(raw);
  const lower = raw.toLowerCase();

  const pick = (list: T[]): Resolution<T> | null => {
    if (list.length === 1) return { kind: 'one', note: list[0] };
    if (list.length > 1) return { kind: 'many', candidates: list };
    return null;
  };

  const byId = items.filter((n) => n.id === raw);
  if (byId.length > 0) return { kind: 'one', note: byId[0] };
  if (raw.length >= MIN_ID_PREFIX) {
    const byIdPrefix = items.filter((n) => n.id.toLowerCase().startsWith(lower));
    const r = pick(byIdPrefix);
    if (r) return r;
  }
  const exact = pick(items.filter((n) => linkKey(n.title) === want));
  if (exact) return exact;
  const prefix = pick(items.filter((n) => linkKey(n.title).startsWith(want)));
  if (prefix) return prefix;
  const file = pick(items.filter((n) => fileNameFor(n.title).toLowerCase() === lower.replace(/\.md$/i, '')));
  if (file) return file;
  const words = want.split(/\s+/).filter(Boolean);
  const fuzzy = items.filter((n) => {
    const t = linkKey(n.title);
    let at = 0;
    for (const w of words) {
      const i = t.indexOf(w, at);
      if (i < 0) return false;
      at = i + w.length;
    }
    return true;
  });
  return pick(fuzzy) ?? { kind: 'none' };
}

/**
 * A live note by any of the ways of naming one, and — since folders — by where
 * it is: a selector with a slash in it is a path from the notes folder, with
 * the `.md` optional. `notes show Work/Clients/Hale` names one note however
 * many others are also called Hale.
 *
 * The path reading is tried first and the ordinary one still follows it, so a
 * note whose title has a slash in it is still findable by that title.
 */
export function resolveNote(notes: Note[], selector: string): Resolution<Note> {
  const raw = selector.trim();
  if (raw.includes('/') || raw.includes('\\')) {
    const want = folderKey(normalizeFolder(raw).replace(/\.md$/i, ''));
    const byPath = notes.filter((n) => folderKey(joinFolder(n.folder ?? ROOT_FOLDER, titleFile(n))) === want);
    if (byPath.length === 1) return { kind: 'one', note: byPath[0] };
    if (byPath.length > 1) return { kind: 'many', candidates: byPath };
  }
  const named = notes.map((n) => ({ id: n.id, title: titleOf(n), note: n }));
  const r = resolveNamed(named, selector);
  if (r.kind === 'one') return { kind: 'one', note: r.note.note };
  if (r.kind === 'many') return { kind: 'many', candidates: r.candidates.map((c) => c.note) };
  return r;
}

/** A note's own filename without its extension: what a path names it by. */
const titleFile = (note: Note): string => (note.file ?? `${fileNameFor(titleOf(note))}.md`).replace(/\.md$/i, '');

/** A trashed note, by id, id prefix or title. */
export function resolveTrashed(items: TrashedNote[], selector: string): Resolution<TrashedNote> {
  return resolveNamed(items, selector);
}
