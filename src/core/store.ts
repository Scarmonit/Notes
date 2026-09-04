import { randomUUID } from 'node:crypto';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { previewOf } from '../shared/history';
import { parseNotesFile } from '../shared/notes-file';
import { fileNameFor, formatNoteFile, isNoteFileName, parseNoteFile, uniqueFileName, type ParsedNoteFile } from '../shared/notes-folder';
import type { ExternalChanges, Note, NotesFile, TrashedNote } from '../shared/types';
import { titleOf } from '../renderer/notes';
import { pathsFor } from './paths';

/**
 * The notes on disk: a folder of markdown files, one per note, named after
 * their titles, with a front-matter block carrying the id and the dates.
 * Put the folder in OneDrive, Dropbox or git and the notes are backed up and
 * readable anywhere, by anything, without the app having a sync service.
 *
 * The caller hands over the whole list on every save. The store keeps what
 * it last wrote for each note and touches only the files whose text would
 * change — while typing, that is one small file every few hundred
 * milliseconds rather than the whole collection.
 *
 * A note that leaves the list is not deleted: its file moves to a trash
 * folder beside the notes, where it waits a month to be put back.
 *
 * Nothing here knows about Electron. The main process makes one store on
 * `app.getPath('userData')`; the command line makes one on the same folder,
 * worked out for itself, and gets the same files, the same names and the
 * same rules.
 */

/** How long a deleted note waits in the trash before it is gone for good. */
export const TRASH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How long the folder must be quiet before it is re-read: sync tools write in bursts. */
export const WATCH_SETTLE_MS = 700;

interface Entry {
  /** The filename inside the notes folder. */
  name: string;
  /** The file's text as last read or written, so an unchanged note costs no write. */
  text: string;
  /** Front-matter lines the app does not understand, written back unchanged. */
  extra: string[];
  /**
   * The change (`ExternalChanges.seq`) that first brought the file in from
   * outside, or 0 for one the store wrote or read at the start. A save whose
   * list was made before that change is missing the note because it has not
   * heard of it, not because it was deleted.
   */
  since: number;
}

interface ReadFile extends ParsedNoteFile {
  name: string;
  text: string;
}

export type ChangeListener = (changes: ExternalChanges) => void;

export interface Store {
  readonly notesDir: string;
  readonly trashDir: string;
  loadNotes(): Promise<NotesFile>;
  saveNotes(file: NotesFile): Promise<void>;
  /** The filename a live note is stored under, once it has been loaded or saved. */
  fileNameOf(id: string): string | null;
  trashedIds(): ReadonlySet<string>;
  listTrash(): Promise<TrashedNote[]>;
  getTrashed(id: string): Promise<Note | null>;
  restoreFromTrash(id: string): Promise<Note | null>;
  purgeTrashed(id: string): Promise<boolean>;
  expireTrash(now?: number): Promise<string[]>;
  /** The bodies of the notes in the trash: what they mention is still spoken for. */
  trashBodies(): Promise<string[]>;
  /** Resolves once every write queued so far has reached the disk. */
  drain(): Promise<void>;
  /** Reads the folder for changes made outside now, as the watcher would, telling the listeners. */
  refresh(): Promise<void>;
  watchNotes(onChange: ChangeListener): void;
  stopWatching(): void;
  /** Called after every write this store makes and every change it notices, with what differs. */
  onChange(listener: ChangeListener): () => void;
}

/**
 * Antivirus and the search indexer hold a freshly written file for a moment
 * on Windows; a rename that meets that gets a few more tries before it gives up.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}

/** Atomically replaces one file: write a sibling tmp file, then rename it over. */
export async function writeAtomic(target: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await renameWithRetry(tmp, target);
}

// Windows does not tell filenames apart by case, so neither does the store.
const lower = (s: string): string => s.toLowerCase();

/**
 * Every note file in a folder, parsed. A file that cannot be read is skipped,
 * not fatal; one that is there but locked (a sync tool or antivirus holding it
 * for a moment) is also named in `unreadable`, so a re-scan does not mistake
 * it for a file that was deleted.
 */
async function readNoteFiles(dir: string, unreadable?: Set<string>): Promise<ReadFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    // A folder that is not there is empty. One that cannot be listed just now
    // (a sync tool or antivirus holding it) is not: taking it for empty would
    // read as every note deleted at once, and a re-scan would trash them all.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
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
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unreadable?.add(lower(name));
    }
  }
  return out;
}

/** Whether a note's current filename already suits its title: `Plan.md` or `Plan 2.md` for "Plan". */
function nameSuits(name: string, base: string): boolean {
  const m = /^(.*?)(?: \d+)?\.md$/i.exec(name);
  return m !== null && lower(m[1]) === lower(base);
}

export function createStore(root: string): Store {
  const paths = pathsFor(root);
  const notesDir = paths.notes;
  const trashDir = paths.trash;

  /** Every live note, by id. */
  const index = new Map<string, Entry>();
  /** The ids waiting in the trash, so their history is kept while they wait. */
  const trashed = new Set<string>();
  const listeners = new Set<ChangeListener>();
  /** Counts the passes over the folder made for changes from outside; see `Entry.since`. */
  let changeSeq = 0;

  function emit(changes: ExternalChanges): void {
    if (changes.upserts.length === 0 && changes.removed.length === 0) return;
    for (const fn of listeners) {
      try {
        fn(changes);
      } catch (err) {
        console.error('[notes] change listener failed', err);
      }
    }
  }

  /** Whether a filename is in use in the notes folder, on disk or in the index. */
  function takenInNotes(name: string, except?: string): boolean {
    if (except && lower(name) === lower(except)) return false;
    for (const entry of index.values()) if (lower(entry.name) === lower(name)) return true;
    return existsSync(path.join(notesDir, name));
  }

  /**
   * Reads the notes folder into the index and returns its notes. A file with no
   * id — dropped in by hand, or copied by a sync tool so that two carry the same
   * id — is given one and written back, so it keeps that id from now on.
   */
  async function readIntoIndex(dir: string): Promise<{ notes: Note[]; changed: Note[]; removed: string[] }> {
    const unreadable = new Set<string>();
    const files = await readNoteFiles(dir, unreadable);
    const seen = new Set<string>();
    const notes: Note[] = [];
    const changed: Note[] = [];
    /** The filenames in this pass, and the ids their front matter states. */
    const present = new Set(files.map((f) => lower(f.name)));
    const stated = new Set(files.filter((f) => !f.needsWrite).map((f) => f.note.id));
    /** Which id each filename held last time, so a file keeps its identity through a rewrite. */
    const owners = new Map<string, string>();
    for (const [id, entry] of index) owners.set(lower(entry.name), id);
    /**
     * On a first read, with nothing known yet, two files stating one id are
     * told apart by their names: the one named for its title is the note,
     * the "(conflicted copy)" is the copy — not whichever sorts first.
     */
    const keeper = new Map<string, string>();
    for (const f of files) {
      if (f.needsWrite || index.has(f.note.id)) continue;
      const held = keeper.get(f.note.id);
      const base = fileNameFor(titleOf(f.note));
      if (held === undefined || (!nameSuits(held, base) && nameSuits(f.name, base))) keeper.set(f.note.id, f.name);
    }
    for (const f of files) {
      let { note, needsWrite } = f;
      const owner = owners.get(lower(f.name));
      if (needsWrite && owner !== undefined && !stated.has(owner)) {
        // A file whose front matter was dropped by an editor is still the note
        // it was: minting a fresh id would make its old one "removed", and the
        // trash would take the very file just stamped with the new one.
        const was = index.get(owner);
        const created = was ? parseNoteFile(was.text, { id: owner, name: f.name, mtime: note.createdAt }).note.createdAt : note.createdAt;
        note = { ...note, id: owner, createdAt: created };
      } else if (!needsWrite) {
        // A copy of a note, made by a sync tool under another name with the
        // id intact, is the newcomer: the file the index already knows by
        // that id stays the note, whichever of the two sorts first.
        const held = index.get(note.id);
        const keep = held ? held.name : keeper.get(note.id);
        if (keep !== undefined && lower(keep) !== lower(f.name) && present.has(lower(keep))) {
          note = { ...note, id: randomUUID() };
          needsWrite = true;
        }
      }
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
      index.set(note.id, { name: f.name, text, extra: f.extra, since: before?.since ?? changeSeq });
      notes.push(note);
    }
    // A file still on disk but unreadable this pass is not gone: its entry stays as last read.
    const removed = [...index].filter(([id, entry]) => !seen.has(id) && !unreadable.has(lower(entry.name))).map(([id]) => id);
    for (const id of removed) index.delete(id);
    return { notes, changed, removed };
  }

  async function migrate(dir: string): Promise<void> {
    const legacy = paths.legacy;
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

  /**
   * Loads the notes. The first launch after the folder appeared brings the old
   * notes.json across, one file per note, and sets it aside as a backup rather
   * than deleting it.
   */
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

  function loadNotes(): Promise<NotesFile> {
    // Queued like every other folder pass: a load that overlaps a save rewrites
    // the index from a folder the save is still changing.
    return queue(async () => {
      if (!existsSync(notesDir)) await migrate(notesDir);
      await fs.mkdir(notesDir, { recursive: true });
      const { notes } = await readIntoIndex(notesDir);
      return { version: 1, notes };
    });
  }

  /** Moves one note's file into the trash, stamped with the moment it left. */
  async function trashEntry(id: string, entry: Entry): Promise<void> {
    const parsed = parseNoteFile(entry.text, { id, name: entry.name.replace(/\.md$/i, ''), mtime: Date.now() });
    const text = formatNoteFile(parsed.note, parsed.extra, Date.now());
    await fs.mkdir(trashDir, { recursive: true });
    const name = uniqueFileName(entry.name.replace(/\.md$/i, ''), (n) => existsSync(path.join(trashDir, n)));
    await writeAtomic(path.join(trashDir, name), text);
    await fs.unlink(path.join(notesDir, entry.name)).catch(() => undefined);
    index.delete(id);
    trashed.add(id);
  }

  /**
   * Writes every note whose text would change, renames the ones whose title
   * has, and moves the ones that are gone to the trash.
   */
  function saveNotes(file: NotesFile): Promise<void> {
    return queue(async () => {
      await fs.mkdir(notesDir, { recursive: true });
      const live = new Set(file.notes.map((n) => n.id));
      const seen = file.seen ?? Infinity;
      const changes: ExternalChanges = { upserts: [], removed: [], seq: changeSeq };
      // Removals first, so a renamed note can take a name a deleted one freed.
      for (const [id, entry] of [...index]) {
        if (live.has(id)) continue;
        // Found from outside after this list was made: not deleted, just not heard of yet.
        if (entry.since > seen) continue;
        await trashEntry(id, entry);
        changes.removed.push(id);
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
              await fs.rename(path.join(notesDir, entry.name), path.join(notesDir, wanted));
              name = wanted;
            } catch (err) {
              console.error(`[notes] could not rename ${entry.name}; keeping the name`, err);
            }
          } else if (!entry) {
            name = wanted;
          }
        }
        await writeAtomic(path.join(notesDir, name), text);
        index.set(note.id, { name, text, extra, since: 0 });
        changes.upserts.push(note);
      }
      emit(changes);
    });
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
  function listTrash(): Promise<TrashedNote[]> {
    return queue(async () => {
      const files = await readNoteFiles(trashDir);
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
    const files = await readNoteFiles(trashDir);
    return files.find((f) => f.note.id === id) ?? null;
  }

  /** The full text of a trashed note, for the sheet to show before it is put back. */
  function getTrashed(id: string): Promise<Note | null> {
    return queue(async () => (await trashFileFor(id))?.note ?? null);
  }

  /**
   * Puts a trashed note back among the live ones, under its own id, so the
   * history it had before it was deleted is its history again.
   */
  function restoreFromTrash(id: string): Promise<Note | null> {
    return queue(async () => {
      const f = await trashFileFor(id);
      if (!f) return null;
      await fs.mkdir(notesDir, { recursive: true });
      const name = uniqueFileName(fileNameFor(titleOf(f.note)), (n) => takenInNotes(n));
      const text = formatNoteFile(f.note, f.extra);
      await writeAtomic(path.join(notesDir, name), text);
      await fs.unlink(path.join(trashDir, f.name)).catch(() => undefined);
      index.set(f.note.id, { name, text, extra: f.extra, since: 0 });
      trashed.delete(f.note.id);
      emit({ upserts: [f.note], removed: [], seq: changeSeq });
      return f.note;
    });
  }

  /** Removes one note from the trash for good. Resolves to whether there was one. */
  function purgeTrashed(id: string): Promise<boolean> {
    return queue(async () => {
      const f = await trashFileFor(id);
      if (!f) return false;
      await fs.unlink(path.join(trashDir, f.name)).catch(() => undefined);
      trashed.delete(id);
      return true;
    });
  }

  /**
   * Empties what has waited long enough. Runs once per launch; resolves to the
   * ids that are now gone, so their history can go too.
   */
  function expireTrash(now = Date.now()): Promise<string[]> {
    return queue(async () => {
      const files = await readNoteFiles(trashDir);
      const gone: string[] = [];
      const kept: string[] = [];
      for (const f of files) {
        const deletedAt = f.deletedAt ?? f.note.updatedAt;
        if (now - deletedAt > TRASH_AGE_MS) {
          await fs.unlink(path.join(trashDir, f.name)).catch(() => undefined);
          gone.push(f.note.id);
        } else {
          kept.push(f.note.id);
        }
      }
      setTrashed(kept);
      return gone;
    });
  }

  // --- changes made outside this store ---------------------------------------

  let watcher: FSWatcher | null = null;
  let watchTimer: NodeJS.Timeout | null = null;

  function checkExternal(onChange: ChangeListener): Promise<void> {
    return queue(async () => {
      const before = new Map(index);
      // Counted before the read, so a file first seen in this pass is dated to the change that reports it.
      changeSeq++;
      const { changed, removed } = await readIntoIndex(notesDir);
      // A file taken away by hand still deserves the trash: what the app last
      // knew of it is written there, so a mis-drag in Explorer costs nothing.
      for (const id of removed) {
        const entry = before.get(id);
        if (entry) await trashEntry(id, entry);
      }
      if (changed.length > 0 || removed.length > 0) {
        const changes: ExternalChanges = { upserts: changed, removed, seq: changeSeq };
        onChange(changes);
        emit(changes);
      }
    }).catch((err) => console.error('[notes] re-reading the folder failed', err));
  }

  /**
   * Watches the notes folder for files changed by something other than this
   * store — a sync tool, an editor on another machine, the command line while
   * the app runs — and reports what differs from the last text it read or
   * wrote. Its own writes raise events too, but they match the index, so they
   * report nothing.
   */
  function watchNotes(onChange: ChangeListener): void {
    if (watcher) return;
    try {
      // Persistent: `notes watch` with the app closed has nothing else keeping
      // the process up. The app closes it on quit, so it costs the app nothing.
      watcher = watch(notesDir, { persistent: true }, () => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => void checkExternal(onChange), WATCH_SETTLE_MS);
      });
      watcher.on('error', (err) => console.error('[notes] folder watch failed', err));
    } catch (err) {
      console.error('[notes] could not watch the notes folder', err);
    }
  }

  function stopWatching(): void {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = null;
    watcher?.close();
    watcher = null;
  }

  return {
    notesDir,
    trashDir,
    loadNotes,
    saveNotes,
    fileNameOf: (id) => index.get(id)?.name ?? null,
    trashedIds: () => trashed,
    listTrash,
    getTrashed,
    restoreFromTrash,
    purgeTrashed,
    expireTrash,
    trashBodies: () => queue(async () => (await readNoteFiles(trashDir)).map((f) => f.note.body)),
    drain: () => queue(async () => undefined),
    refresh: () => checkExternal(() => undefined),
    watchNotes,
    stopWatching,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
