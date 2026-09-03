import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { previewOf } from '../shared/history';
import { parseNotesFile } from '../shared/notes-file';
import { fileNameFor, formatNoteFile, isNoteFileName, parseNoteFile, uniqueFileName, type ParsedNoteFile } from '../shared/notes-folder';
import type { ExternalChanges, Note, NotesFile, TrashedNote } from '../shared/types';
import { titleOf } from '../renderer/notes';

/**
 * The notes on disk: a folder of markdown files, one per note, named after
 * their titles, with a front-matter block carrying the id and the dates.
 * Put the folder in OneDrive, Dropbox or git and the notes are backed up and
 * readable anywhere, by anything, without the app having a sync service.
 *
 * The renderer still hands over the whole list on every save. This module
 * keeps what it last wrote for each note and touches only the files whose
 * text would change — while typing, that is one small file every few
 * hundred milliseconds rather than the whole collection.
 *
 * A note that leaves the list is not deleted: its file moves to a trash
 * folder beside the notes, where it waits a month to be put back.
 */

export function notesDir(): string {
  return path.join(app.getPath('userData'), 'notes');
}

export function trashDir(): string {
  return path.join(app.getPath('userData'), 'trash');
}

/** Where notes lived before 0.11: one JSON file. Read once, then set aside. */
function legacyPath(): string {
  return path.join(app.getPath('userData'), 'notes.json');
}

/** How long a deleted note waits in the trash before it is gone for good. */
export const TRASH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Entry {
  /** The filename inside the notes folder. */
  name: string;
  /** The file's text as last read or written, so an unchanged note costs no write. */
  text: string;
  /** Front-matter lines the app does not understand, written back unchanged. */
  extra: string[];
}

/** Every live note, by id. */
const index = new Map<string, Entry>();
/** The ids waiting in the trash, so their history is kept while they wait. */
const trashed = new Set<string>();

/** Atomically replaces one file: write a sibling tmp file, then rename it over. */
async function writeAtomic(target: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, target);
}

interface ReadFile extends ParsedNoteFile {
  name: string;
  text: string;
}

/** Every note file in a folder, parsed. A file that cannot be read is skipped, not fatal. */
async function readNoteFiles(dir: string): Promise<ReadFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: ReadFile[] = [];
  for (const name of names.filter(isNoteFileName).sort()) {
    const full = path.join(dir, name);
    try {
      const [text, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
      const parsed = parseNoteFile(text, { id: randomUUID(), name: name.replace(/\.md$/i, ''), mtime: stat.mtimeMs });
      out.push({ ...parsed, name, text });
    } catch (err) {
      console.error(`[notes] could not read ${name}`, err);
    }
  }
  return out;
}

// Windows does not tell filenames apart by case, so neither does the store.
const lower = (s: string): string => s.toLowerCase();

/** Whether a filename is in use in the notes folder, on disk or in the index. */
function takenInNotes(name: string, except?: string): boolean {
  if (except && lower(name) === lower(except)) return false;
  for (const entry of index.values()) if (lower(entry.name) === lower(name)) return true;
  return existsSync(path.join(notesDir(), name));
}

/**
 * Reads the notes folder into the index and returns its notes. A file with no
 * id — dropped in by hand, or copied by a sync tool so that two carry the same
 * id — is given one and written back, so it keeps that id from now on.
 */
async function readIntoIndex(dir: string): Promise<{ notes: Note[]; changed: Note[]; removed: string[] }> {
  const files = await readNoteFiles(dir);
  const seen = new Set<string>();
  const notes: Note[] = [];
  const changed: Note[] = [];
  for (const f of files) {
    let { note, needsWrite } = f;
    if (seen.has(note.id)) {
      note = { ...note, id: randomUUID() };
      needsWrite = true;
    }
    seen.add(note.id);
    let text = f.text;
    if (needsWrite) {
      text = formatNoteFile(note, f.extra);
      await writeAtomic(path.join(dir, f.name), text).catch((err) => console.error(`[notes] could not stamp ${f.name}`, err));
    }
    const before = index.get(note.id);
    if (!before || before.text !== text) changed.push(note);
    index.set(note.id, { name: f.name, text, extra: f.extra });
    notes.push(note);
  }
  const removed = [...index.keys()].filter((id) => !seen.has(id));
  for (const id of removed) index.delete(id);
  return { notes, changed, removed };
}

/**
 * Loads the notes. The first launch after the folder appeared brings the old
 * notes.json across, one file per note, and sets it aside as a backup rather
 * than deleting it.
 */
export async function loadNotes(): Promise<NotesFile> {
  const dir = notesDir();
  if (!existsSync(dir)) await migrate(dir);
  await fs.mkdir(dir, { recursive: true });
  const { notes } = await readIntoIndex(dir);
  return { version: 1, notes };
}

async function migrate(dir: string): Promise<void> {
  const legacy = legacyPath();
  let raw: string;
  try {
    raw = await fs.readFile(legacy, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  let file: NotesFile;
  try {
    file = parseNotesFile(raw);
  } catch (err) {
    console.error('[notes] notes.json is unreadable, starting empty:', err);
    await fs.copyFile(legacy, `${legacy}.corrupt-${Date.now()}`).catch(() => undefined);
    return;
  }
  await fs.mkdir(dir, { recursive: true });
  const taken = new Set<string>();
  for (const note of file.notes) {
    const name = uniqueFileName(fileNameFor(titleOf(note)), (n) => taken.has(lower(n)));
    taken.add(lower(name));
    await writeAtomic(path.join(dir, name), formatNoteFile(note));
  }
  // Every note is in the folder; the old file stays beside it, renamed so it
  // is plainly a backup and never read as the notes again.
  let backup = `${legacy}.migrated`;
  if (existsSync(backup)) backup = `${legacy}.migrated-${Date.now()}`;
  await fs.rename(legacy, backup);
  console.log(`[notes] moved ${file.notes.length} notes into ${dir}; the old file is ${path.basename(backup)}`);
}

// One pass over the folder at a time: saves come every few hundred
// milliseconds while typing, and a re-read must never interleave with one.
let chain: Promise<void> = Promise.resolve();

function queue<T>(run: () => Promise<T>): Promise<T> {
  const result = chain.then(run, run);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Whether a note's current filename already suits its title: `Plan.md` or `Plan 2.md` for "Plan". */
function nameSuits(name: string, base: string): boolean {
  const m = /^(.*?)(?: \d+)?\.md$/i.exec(name);
  return m !== null && lower(m[1]) === lower(base);
}

/**
 * Writes every note whose text would change, renames the ones whose title
 * has, and moves the ones that are gone to the trash.
 */
export function saveNotes(file: NotesFile): Promise<void> {
  return queue(async () => {
    const dir = notesDir();
    await fs.mkdir(dir, { recursive: true });
    const live = new Set(file.notes.map((n) => n.id));
    // Removals first, so a renamed note can take a name a deleted one freed.
    for (const [id, entry] of [...index]) {
      if (live.has(id)) continue;
      await trashEntry(id, entry);
    }
    for (const note of file.notes) {
      const entry = index.get(note.id);
      const extra = entry?.extra ?? [];
      const text = formatNoteFile(note, extra);
      if (entry && entry.text === text) continue;
      const base = fileNameFor(titleOf(note));
      let name = entry?.name ?? '';
      if (!entry || !nameSuits(name, base)) {
        const wanted = uniqueFileName(base, (n) => takenInNotes(n, entry?.name));
        if (entry && lower(wanted) !== lower(entry.name)) {
          try {
            await fs.rename(path.join(dir, entry.name), path.join(dir, wanted));
            name = wanted;
          } catch (err) {
            console.error(`[notes] could not rename ${entry.name}; keeping the name`, err);
          }
        } else if (!entry) {
          name = wanted;
        }
      }
      await writeAtomic(path.join(dir, name), text);
      index.set(note.id, { name, text, extra });
    }
  });
}

/** Moves one note's file into the trash, stamped with the moment it left. */
async function trashEntry(id: string, entry: Entry): Promise<void> {
  const parsed = parseNoteFile(entry.text, { id, name: entry.name.replace(/\.md$/i, ''), mtime: Date.now() });
  const text = formatNoteFile(parsed.note, parsed.extra, Date.now());
  const trash = trashDir();
  await fs.mkdir(trash, { recursive: true });
  const name = uniqueFileName(entry.name.replace(/\.md$/i, ''), (n) => existsSync(path.join(trash, n)));
  await writeAtomic(path.join(trash, name), text);
  await fs.unlink(path.join(notesDir(), entry.name)).catch(() => undefined);
  index.delete(id);
  trashed.add(id);
}

/** The ids of the notes waiting in the trash. */
export function trashedIds(): ReadonlySet<string> {
  return trashed;
}

/**
 * Replaces the set of trashed ids in one step. The history sweep reads the
 * set whenever its turn comes; emptying it and refilling it across a read of
 * the folder would leave a moment in which every trashed note looked gone,
 * and its history with it.
 */
function setTrashed(ids: Iterable<string>): void {
  const next = [...ids];
  trashed.clear();
  for (const id of next) trashed.add(id);
}

/** Everything in the trash, most recently deleted first. */
export function listTrash(): Promise<TrashedNote[]> {
  return queue(async () => {
    const files = await readNoteFiles(trashDir());
    setTrashed(files.map((f) => f.note.id));
    const out: TrashedNote[] = [];
    for (const f of files) {
      out.push({
        id: f.note.id,
        title: titleOf(f.note),
        preview: previewOf(f.note.body),
        chars: f.note.body.length,
        updatedAt: f.note.updatedAt,
        deletedAt: f.deletedAt ?? f.note.updatedAt,
      });
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  });
}

async function trashFileFor(id: string): Promise<ReadFile | null> {
  const files = await readNoteFiles(trashDir());
  return files.find((f) => f.note.id === id) ?? null;
}

/** The full text of a trashed note, for the sheet to show before it is put back. */
export function getTrashed(id: string): Promise<Note | null> {
  return queue(async () => (await trashFileFor(id))?.note ?? null);
}

/**
 * Puts a trashed note back among the live ones, under its own id, so the
 * history it had before it was deleted is its history again.
 */
export function restoreFromTrash(id: string): Promise<Note | null> {
  return queue(async () => {
    const f = await trashFileFor(id);
    if (!f) return null;
    const dir = notesDir();
    await fs.mkdir(dir, { recursive: true });
    const name = uniqueFileName(fileNameFor(titleOf(f.note)), (n) => takenInNotes(n));
    const text = formatNoteFile(f.note, f.extra);
    await writeAtomic(path.join(dir, name), text);
    await fs.unlink(path.join(trashDir(), f.name)).catch(() => undefined);
    index.set(f.note.id, { name, text, extra: f.extra });
    trashed.delete(f.note.id);
    return f.note;
  });
}

/** Removes one note from the trash for good. Resolves to whether there was one. */
export function purgeTrashed(id: string): Promise<boolean> {
  return queue(async () => {
    const f = await trashFileFor(id);
    if (!f) return false;
    await fs.unlink(path.join(trashDir(), f.name)).catch(() => undefined);
    trashed.delete(id);
    return true;
  });
}

/**
 * Empties what has waited long enough. Runs once per launch; resolves to the
 * ids that are now gone, so their history can go too.
 */
export function expireTrash(now = Date.now()): Promise<string[]> {
  return queue(async () => {
    const files = await readNoteFiles(trashDir());
    const gone: string[] = [];
    const kept: string[] = [];
    for (const f of files) {
      const deletedAt = f.deletedAt ?? f.note.updatedAt;
      if (now - deletedAt > TRASH_AGE_MS) {
        await fs.unlink(path.join(trashDir(), f.name)).catch(() => undefined);
        gone.push(f.note.id);
      } else {
        kept.push(f.note.id);
      }
    }
    setTrashed(kept);
    return gone;
  });
}

// --- changes made outside the app -------------------------------------------

let watcher: FSWatcher | null = null;
let watchTimer: NodeJS.Timeout | null = null;

/** How long the folder must be quiet before it is re-read: sync tools write in bursts. */
const WATCH_SETTLE_MS = 700;

/**
 * Watches the notes folder for files changed by something other than the
 * app — a sync tool, an editor on another machine — and reports what
 * differs from the last text the app read or wrote. The app's own writes
 * raise events too, but they match the index, so they report nothing.
 */
export function watchNotes(onChange: (changes: ExternalChanges) => void): void {
  if (watcher) return;
  const dir = notesDir();
  try {
    watcher = watch(dir, { persistent: false }, () => {
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => void checkExternal(onChange), WATCH_SETTLE_MS);
    });
    watcher.on('error', (err) => console.error('[notes] folder watch failed', err));
  } catch (err) {
    console.error('[notes] could not watch the notes folder', err);
  }
}

function checkExternal(onChange: (changes: ExternalChanges) => void): Promise<void> {
  return queue(async () => {
    const before = new Map(index);
    const { changed, removed } = await readIntoIndex(notesDir());
    // A file taken away by hand still deserves the trash: what the app last
    // knew of it is written there, so a mis-drag in Explorer costs nothing.
    for (const id of removed) {
      const entry = before.get(id);
      if (entry) await trashEntry(id, entry);
    }
    if (changed.length > 0 || removed.length > 0) onChange({ upserts: changed, removed });
  }).catch((err) => console.error('[notes] re-reading the folder failed', err));
}

export function stopWatching(): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  watcher?.close();
  watcher = null;
}
