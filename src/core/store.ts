import { randomUUID } from 'node:crypto';
import { existsSync, watch, type Dirent, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { previewOf } from '../shared/history';
import { parseNotesFile } from '../shared/notes-file';
import {
  fileNameOf as baseNameOf,
  folderKey,
  folderLabel,
  folderName,
  folderOf,
  folderProblem,
  isSelfOrInside,
  joinFolder,
  parentFolder,
  ROOT_FOLDER,
  segmentProblem,
} from '../shared/folders';
import { fileNameFor, formatNoteFile, isNoteFileName, parseNoteFile, propertiesOf, RESERVED, uniqueFileName, withoutProperty, withProperty, type FrontMatterEntry, type ParsedNoteFile } from '../shared/notes-folder';
import { AmbiguousProperty, SIMPLE_KEY, type NoteProperty, type PropertyChange } from '../shared/properties';
import type { ExternalChanges, Note, NotesFile, TrashedNote } from '../shared/types';
import { titleOf } from '../renderer/notes';
import { pathsFor } from './paths';

/**
 * The notes on disk: a tree of folders holding markdown files, one per note,
 * named after their titles, with a front-matter block carrying the id and the
 * dates. A note's folder is its path inside the notes folder and nothing else:
 * the filesystem is the only thing that says where a note is, so a note moved
 * in Explorer needs no agreement from the app.
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

/**
 * A note whose file has gone from the folder without the app deleting it.
 *
 * A sync tool moving a note between two folders takes the file away and puts
 * it back a moment later, and the two halves need not land in the same scan.
 * Trashing it in the gap would leave a copy in the trash and a note on disk
 * once it arrived; forgetting it would let the history sweep take its versions
 * with it. So it is written down instead, and the moment the id turns up
 * anywhere in the notebook again it is the same note, with its history intact.
 * A note that never comes back is forgotten after the same month the trash
 * gives a deleted one.
 */
export interface MissingNote {
  /** Where it was last seen, inside the notes folder. */
  path: string;
  /** When it went. */
  at: number;
}

/** How long the folder must be quiet before it is re-read: sync tools write in bursts. */
export const WATCH_SETTLE_MS = 700;

interface Entry {
  /** The path inside the notes folder, `/`-separated: `Work/Clients/Hale.md`. */
  name: string;
  /** The file's text as last read or written, so an unchanged note costs no write. */
  text: string;
  /** Front-matter lines the app does not understand, written back unchanged. */
  frontMatter: FrontMatterEntry[];
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
  /**
   * The path a live note is stored under inside the notes folder, once it has
   * been loaded or saved: `Work/Clients/Hale.md`, or `Hale.md` at the root.
   */
  fileNameOf(id: string): string | null;
  /** Every folder in the notebook, empty ones included, deepest last. */
  listFolders(): Promise<string[]>;
  /** Makes a folder and every folder above it. Resolves to what it made. */
  createFolder(folder: string): Promise<string>;
  /** Changes a folder's last name, keeping it where it is. Resolves to its new path. */
  renameFolder(folder: string, name: string): Promise<string>;
  /** Puts a folder, and everything inside it, into another. Resolves to its new path. */
  moveFolder(folder: string, into: string): Promise<string>;
  /** Removes a folder that holds nothing. */
  deleteFolder(folder: string): Promise<void>;
  /** Files a note in another folder. Resolves to its new path inside the notes folder. */
  moveNote(id: string, folder: string): Promise<string>;
  /**
   * Sets, changes or removes one front-matter property on a note.
   *
   * Its own operation rather than something carried on a save, for the same
   * reason moving a note is: `Note.properties` is a reading of the file, and
   * writing one back would mean the whole front matter travelling through
   * every autosave. Here only the named occurrence's span is touched.
   */
  setProperty(id: string, change: PropertyChange): Promise<NoteProperty[]>;
  trashedIds(): ReadonlySet<string>;
  /**
   * The notes whose history must be kept though they are not in the list: the
   * ones waiting in the trash, and the ones whose files have gone missing.
   */
  keptIds(): ReadonlySet<string>;
  /** The notes whose files went away without the app deleting them, by id. */
  missingIds(): ReadonlySet<string>;
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
 * A directory the scan does not go into, and does not show. A dot folder is
 * someone else's business — `.git`, `.obsidian`, `.trash` — and the notebook's
 * own attachments folder is the app's, holding pictures rather than notes. A
 * folder somebody names `attachments` further down is an ordinary folder: only
 * the reserved one at the top is skipped, which is why this takes a depth.
 */
function skipDir(name: string, depth: number, reserved: ReadonlySet<string>): boolean {
  return name.startsWith('.') || (depth === 0 && reserved.has(lower(name)));
}

/**
 * Every note file in a folder and in the folders inside it, parsed, each under
 * the path it is at: `Work/Clients/Hale.md`. A file that cannot be read is
 * skipped, not fatal; one that is there but locked (a sync tool or antivirus
 * holding it for a moment) is also named in `unreadable`, so a re-scan does not
 * mistake it for a file that was deleted.
 *
 * The whole tree is read in one pass, which is what lets a note that has moved
 * between two folders be recognised as the note it was rather than as one file
 * deleted and another created.
 */
async function readNoteFiles(dir: string, unreadable?: Set<string>, reserved: ReadonlySet<string> = new Set()): Promise<ReadFile[]> {
  const out: ReadFile[] = [];
  const walk = async (at: string, rel: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(at, { withFileTypes: true });
    } catch (err) {
      // A folder that is not there is empty. One that cannot be listed just now
      // (a sync tool or antivirus holding it) is not: taking it for empty would
      // read as every note deleted at once, and a re-scan would trash them all.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (rel) {
        console.error(`[notes] could not list ${rel}`, err);
        return;
      }
      throw err;
    }
    const dirs: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // A junction or a symlink is not followed: a loop would never end, and a
      // folder that is really somewhere else is not part of this notebook.
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        // Something named like a note that is not a file is the note's place
        // held against us — a lock, or a sync tool mid-write. It is there and
        // it cannot be read, which is not the same as gone, and it is
        // certainly not a folder called "Plan.md".
        if (isNoteFileName(entry.name)) unreadable?.add(lower(joinFolder(rel, entry.name)));
        else if (!skipDir(entry.name, depth, reserved)) dirs.push(entry.name);
        continue;
      }
      if (!entry.isFile() || !isNoteFileName(entry.name)) continue;
      const name = joinFolder(rel, entry.name);
      const full = path.join(at, entry.name);
      try {
        const [text, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
        const parsed = parseNoteFile(text, { id: randomUUID(), name: entry.name.replace(/\.md$/i, ''), mtime: stat.mtimeMs });
        out.push({ ...parsed, name, text });
      } catch (err) {
        console.error(`[notes] could not read ${name}`, err);
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unreadable?.add(lower(name));
      }
    }
    for (const name of dirs) await walk(path.join(at, name), joinFolder(rel, name), depth + 1);
  };
  await walk(dir, ROOT_FOLDER, 0);
  return out;
}

/** Every folder inside a directory, root-relative, a parent always before its children. */
async function readFolders(dir: string, reserved: ReadonlySet<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, rel: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (skipDir(entry.name, depth, reserved)) continue;
      const folder = joinFolder(rel, entry.name);
      out.push(folder);
      await walk(path.join(at, entry.name), folder, depth + 1);
    }
  };
  await walk(dir, ROOT_FOLDER, 0);
  return out;
}

/** A note's folder path turned into a real one on this machine. */
const dirAt = (root: string, folder: string): string => (folder ? path.join(root, ...folder.split('/')) : root);

/** A note file's path turned into a real one on this machine. */
const fileAt = (root: string, rel: string): string => path.join(root, ...rel.split('/'));

/** Whether a note's current filename already suits its title: `Plan.md` or `Plan 2.md` for "Plan". */
function nameSuits(name: string, base: string): boolean {
  const m = /^(.*?)(?: \d+)?\.md$/i.exec(name);
  return m !== null && lower(m[1]) === lower(base);
}

export function createStore(root: string): Store {
  const paths = pathsFor(root);
  const notesDir = paths.notes;
  const trashDir = paths.trash;
  /**
   * Folders at the top of the notebook that are the app's rather than the
   * notebook's. Only `attachments`, and only when it is in there at all: with
   * the notes left where the app puts them the pictures are elsewhere, and
   * nothing is reserved.
   */
  const reserved = new Set<string>(
    path.resolve(path.dirname(paths.attachments)) === path.resolve(notesDir) ? [lower(path.basename(paths.attachments))] : [],
  );

  /** Every live note, by id. */
  const index = new Map<string, Entry>();
  /** The ids waiting in the trash, so their history is kept while they wait. */
  const trashed = new Set<string>();
  /** The notes whose files have gone without the app deleting them, by id. */
  const missing = new Map<string, MissingNote>();
  let missingRead = false;
  let missingDirty = false;
  const listeners = new Set<ChangeListener>();
  /** Counts the passes over the folder made for changes from outside; see `Entry.since`. */
  let changeSeq = 0;

  /** Reads `missing.json` once. Nothing there, or nothing readable, is nothing missing. */
  async function readMissing(): Promise<void> {
    if (missingRead) return;
    missingRead = true;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(paths.missing, 'utf8'));
      if (!raw || typeof raw !== 'object') return;
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const at = (value as MissingNote)?.at;
        const where = (value as MissingNote)?.path;
        if (typeof at === 'number' && typeof where === 'string') missing.set(id, { path: where, at });
      }
    } catch {
      // No such file, or unreadable: nothing is known to be missing.
    }
  }

  /** Writes the missing notes back, and takes the file away once there are none. */
  async function flushMissing(): Promise<void> {
    if (!missingDirty) return;
    missingDirty = false;
    try {
      if (missing.size === 0) await fs.unlink(paths.missing).catch(() => undefined);
      else await writeAtomic(paths.missing, `${JSON.stringify(Object.fromEntries(missing), null, 2)}\n`);
    } catch (err) {
      console.error('[notes] could not write the missing notes', err);
    }
  }

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
    return existsSync(fileAt(notesDir, name));
  }

  /**
   * Reads the notes folder into the index and returns its notes. A file with no
   * id — dropped in by hand, or copied by a sync tool so that two carry the same
   * id — is given one and written back, so it keeps that id from now on.
   */
  async function readIntoIndex(dir: string): Promise<{ notes: Note[]; changed: Note[]; removed: string[] }> {
    const unreadable = new Set<string>();
    const files = await readNoteFiles(dir, unreadable, reserved);
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
        text = formatNoteFile(note, f.frontMatter);
        await writeAtomic(fileAt(dir, f.name), text).catch((err) => console.error(`[notes] could not stamp ${f.name}`, err));
      }
      // The folder is where the file is, and is put on the note here rather
      // than written into it: nothing on disk says where a note lives except
      // the path it is at.
      note = { ...note, folder: folderOf(f.name), file: baseNameOf(f.name) };
      const before = index.get(note.id);
      // A note whose path changed has changed, though every byte of it is the
      // same: it is somewhere else now, and the window is showing where.
      if (!before || before.text !== text || before.name !== f.name) changed.push(note);
      index.set(note.id, { name: f.name, text, frontMatter: f.frontMatter, since: before?.since ?? changeSeq });
      // Found again, wherever it turned up: the same note, with its history.
      if (missing.delete(note.id)) missingDirty = true;
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
      await readMissing();
      if (!existsSync(notesDir)) await migrate(notesDir);
      await fs.mkdir(notesDir, { recursive: true });
      const { notes } = await readIntoIndex(notesDir);
      const folders = await readFolders(notesDir, reserved);
      await flushMissing();
      return { version: 1, notes, folders };
    });
  }

  /** Moves one note's file into the trash, stamped with the moment it left. */
  async function trashEntry(id: string, entry: Entry): Promise<void> {
    const parsed = parseNoteFile(entry.text, { id, name: baseNameOf(entry.name).replace(/\.md$/i, ''), mtime: Date.now() });
    const text = formatNoteFile(parsed.note, parsed.frontMatter, Date.now());
    await fs.mkdir(trashDir, { recursive: true });
    // The trash keeps the shape of the notebook, so a note put back goes back
    // where it was rather than into the pile at the root.
    const name = uniqueFileName(entry.name.replace(/\.md$/i, ''), (n) => existsSync(fileAt(trashDir, n)));
    await writeAtomic(fileAt(trashDir, name), text);
    await fs.unlink(fileAt(notesDir, entry.name)).catch(() => undefined);
    // The folder the note left is not tidied away: an empty folder in the
    // notebook is a place somebody made, and deleting a note is not a reason
    // to take it.
    index.delete(id);
    trashed.add(id);
    if (missing.delete(id)) missingDirty = true;
  }

  /**
   * Takes away the folders a file left behind in the trash. Only there: an
   * empty folder in the notebook is a place someone made, but one in the
   * trash is the shadow of a note that is gone.
   */
  async function pruneTrashFolders(folder: string): Promise<void> {
    for (let at = folder; at; at = parentFolder(at)) {
      try {
        await fs.rmdir(dirAt(trashDir, at));
      } catch {
        return;
      }
    }
  }

  /** Writes down that a note's file has gone, without deciding that it was deleted. */
  function markMissing(id: string, where: string): void {
    if (missing.has(id)) return;
    missing.set(id, { path: where, at: Date.now() });
    missingDirty = true;
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
        const frontMatter = entry?.frontMatter ?? [];
        const text = formatNoteFile(note, frontMatter);
        if (entry && entry.text === text) continue;
        // Where the note already is, or — for one the store has never seen —
        // where the caller asked for it to be made. A save never moves a note
        // the store knows: moving is its own operation, so that a stale list
        // from a window that has not heard of a move cannot undo it.
        const folder = entry ? folderOf(entry.name) : (note.folder ?? ROOT_FOLDER);
        const base = joinFolder(folder, fileNameFor(titleOf(note)));
        let name = entry?.name ?? '';
        if (!entry || !nameSuits(name, base)) {
          const wanted = uniqueFileName(base, (n) => takenInNotes(n, entry?.name));
          if (entry && lower(wanted) !== lower(entry.name)) {
            try {
              await fs.rename(fileAt(notesDir, entry.name), fileAt(notesDir, wanted));
              name = wanted;
            } catch (err) {
              console.error(`[notes] could not rename ${entry.name}; keeping the name`, err);
            }
          } else if (!entry) {
            name = wanted;
          }
        }
        await writeAtomic(fileAt(notesDir, name), text);
        index.set(note.id, { name, text, frontMatter, since: 0 });
        changes.upserts.push({ ...note, folder: folderOf(name), file: baseNameOf(name) });
      }
      await flushMissing();
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
      // Back into the folder it was deleted from, which is made again if it
      // has gone in the meantime.
      const folder = folderOf(f.name);
      const name = uniqueFileName(joinFolder(folder, fileNameFor(titleOf(f.note))), (n) => takenInNotes(n));
      const text = formatNoteFile(f.note, f.frontMatter);
      await writeAtomic(fileAt(notesDir, name), text);
      await fs.unlink(fileAt(trashDir, f.name)).catch(() => undefined);
      await pruneTrashFolders(folder);
      index.set(f.note.id, { name, text, frontMatter: f.frontMatter, since: 0 });
      trashed.delete(f.note.id);
      const back: Note = { ...f.note, folder, file: baseNameOf(name) };
      emit({ upserts: [back], removed: [], seq: changeSeq });
      return back;
    });
  }

  /** Removes one note from the trash for good. Resolves to whether there was one. */
  function purgeTrashed(id: string): Promise<boolean> {
    return queue(async () => {
      const f = await trashFileFor(id);
      if (!f) return false;
      await fs.unlink(fileAt(trashDir, f.name)).catch(() => undefined);
      await pruneTrashFolders(folderOf(f.name));
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
      await readMissing();
      const files = await readNoteFiles(trashDir);
      const gone: string[] = [];
      const kept: string[] = [];
      for (const f of files) {
        const deletedAt = f.deletedAt ?? f.note.updatedAt;
        if (now - deletedAt > TRASH_AGE_MS) {
          await fs.unlink(fileAt(trashDir, f.name)).catch(() => undefined);
          await pruneTrashFolders(folderOf(f.name));
          gone.push(f.note.id);
        } else {
          kept.push(f.note.id);
        }
      }
      setTrashed(kept);
      // A note that went missing and never came back has waited the month the
      // trash gives; its history goes now, the same as a deleted note's.
      for (const [id, note] of [...missing]) {
        if (now - note.at <= TRASH_AGE_MS) continue;
        missing.delete(id);
        missingDirty = true;
        gone.push(id);
      }
      await flushMissing();
      return gone;
    });
  }


  // --- folders ---------------------------------------------------------------

  /**
   * The folder on disk spelt as it is spelt there, or null when there is none.
   * Windows does not tell folders apart by case, so neither does this: asking
   * for `work` finds `Work`, and the answer is the one that exists.
   */
  async function existing(folder: string): Promise<string | null> {
    if (folder === ROOT_FOLDER) return ROOT_FOLDER;
    const all = await readFolders(notesDir, reserved);
    return all.find((f) => folderKey(f) === folderKey(folder)) ?? null;
  }

  /** A folder that must be there, or a refusal that names it. */
  async function mustExist(folder: string): Promise<string> {
    const found = await existing(folder);
    if (found === null) throw new Error(`There is no folder called ${folderLabel(folder)}`);
    return found;
  }

  /** After a folder has moved: re-read the tree and tell everyone what is where now. */
  async function reindex(): Promise<void> {
    const { changed, removed } = await readIntoIndex(notesDir);
    await flushMissing();
    if (changed.length > 0 || removed.length > 0) emit({ upserts: changed, removed, seq: changeSeq });
  }

  function listFolders(): Promise<string[]> {
    return queue(() => readFolders(notesDir, reserved));
  }

  function createFolder(folder: string): Promise<string> {
    return queue(async () => {
      const problem = folderProblem(folder);
      if (problem) throw new Error(problem);
      if (folder === ROOT_FOLDER) throw new Error('A folder needs a name');
      const already = await existing(folder);
      // One that is already there under another casing is that one: Windows
      // would have given us it anyway, and saying so is better than pretending.
      if (already !== null) return already;
      await fs.mkdir(dirAt(notesDir, folder), { recursive: true });
      return folder;
    });
  }

  function renameFolder(folder: string, name: string): Promise<string> {
    return queue(async () => {
      if (folder === ROOT_FOLDER) throw new Error('The notebook itself cannot be renamed');
      const problem = segmentProblem(name.trim());
      if (problem) throw new Error(problem);
      const from = await mustExist(folder);
      const to = joinFolder(parentFolder(from), name.trim());
      if (to === from) return from;
      // A folder that differs only in case is this one under another spelling,
      // which is a rename worth allowing; any other name already taken is not.
      const clash = await existing(to);
      if (clash !== null && folderKey(clash) !== folderKey(from)) throw new Error(`There is already a folder called ${folderLabel(to)}`);
      await renameWithRetry(dirAt(notesDir, from), dirAt(notesDir, to));
      await reindex();
      return to;
    });
  }

  function moveFolder(folder: string, into: string): Promise<string> {
    return queue(async () => {
      if (folder === ROOT_FOLDER) throw new Error('The notebook itself cannot be moved');
      const from = await mustExist(folder);
      const parent = await mustExist(into);
      if (isSelfOrInside(from, parent)) throw new Error('A folder cannot be put inside itself');
      const to = joinFolder(parent, folderName(from));
      if (folderKey(to) === folderKey(from)) return from;
      if ((await existing(to)) !== null) throw new Error(`There is already a folder called ${folderLabel(to)}`);
      await fs.mkdir(dirAt(notesDir, parent), { recursive: true });
      await renameWithRetry(dirAt(notesDir, from), dirAt(notesDir, to));
      await reindex();
      return to;
    });
  }

  function deleteFolder(folder: string): Promise<void> {
    return queue(async () => {
      if (folder === ROOT_FOLDER) throw new Error('The notebook itself cannot be deleted');
      const found = await mustExist(folder);
      try {
        // Only an empty one: everything in the notebook is a file somebody
        // wrote, and no folder command may take one of those with it.
        await fs.rmdir(dirAt(notesDir, found));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM') {
          throw new Error(`${folderLabel(found)} still has something in it; empty it first`);
        }
        throw err;
      }
    });
  }

  function setProperty(id: string, change: PropertyChange): Promise<NoteProperty[]> {
    return queue(async () => {
      const entry = index.get(id);
      if (!entry) throw new Error('That note is not in the notebook');
      const key = change.key.trim();
      if (RESERVED.has(key)) throw new Error(`'${key}' is one of the note's own fields; it has its own command`);
      if (change.value !== undefined && !SIMPLE_KEY.test(key)) throw new Error(`'${key}' is not a name a property can have`);
      const held = propertiesOf(entry.frontMatter).filter((p) => p.key === key);
      if (held.length === 0 && change.value === undefined) throw new Error(`That note has no '${key}'`);
      // Which one, when a key was written twice: the app shows both and asks
      // rather than picking, so an unqualified change to a duplicate is refused.
      if (held.length > 1 && change.occurrence === undefined && !change.all) throw new AmbiguousProperty(key, held.length);
      const next =
        change.all && change.value === undefined
          ? withoutProperty(entry.frontMatter, key)
          : withProperty(entry.frontMatter, key, change.value, change.occurrence ?? 1);
      const parsed = parseNoteFile(entry.text, { id, name: baseNameOf(entry.name).replace(/.md$/i, ''), mtime: Date.now() });
      const text = formatNoteFile(parsed.note, next, parsed.deletedAt);
      await writeAtomic(fileAt(notesDir, entry.name), text);
      index.set(id, { ...entry, text, frontMatter: next });
      const props = propertiesOf(next);
      const note: Note = { ...parsed.note, folder: folderOf(entry.name), file: baseNameOf(entry.name) };
      if (props.length > 0) note.properties = props;
      else delete note.properties;
      emit({ upserts: [note], removed: [], seq: changeSeq });
      return props;
    });
  }

  function moveNote(id: string, folder: string): Promise<string> {
    return queue(async () => {
      const entry = index.get(id);
      if (!entry) throw new Error('That note is not in the notebook');
      const target = await mustExist(folder);
      if (folderKey(folderOf(entry.name)) === folderKey(target)) return entry.name;
      // The name goes with the note. Moving never renames, so the only reason
      // it can end up called something else is a name already taken there.
      const base = baseNameOf(entry.name).replace(/\.md$/i, '');
      const wanted = uniqueFileName(joinFolder(target, base), (n) => takenInNotes(n, entry.name));
      await fs.mkdir(dirAt(notesDir, target), { recursive: true });
      await renameWithRetry(fileAt(notesDir, entry.name), fileAt(notesDir, wanted));
      index.set(id, { ...entry, name: wanted });
      const parsed = parseNoteFile(entry.text, { id, name: base, mtime: Date.now() });
      emit({ upserts: [{ ...parsed.note, folder: target, file: baseNameOf(wanted) }], removed: [], seq: changeSeq });
      return wanted;
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
      await readMissing();
      const { changed, removed } = await readIntoIndex(notesDir);
      // A file that is gone from the folder is not a note that was deleted.
      // Only the app deleting one puts it in the trash; everything else — a
      // sync tool halfway through moving it, a folder taken away and put back
      // — is written down as missing, and the note is whole again the moment
      // its id turns up anywhere in the notebook.
      for (const id of removed) {
        const entry = before.get(id);
        if (entry) markMissing(id, entry.name);
      }
      await flushMissing();
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
    listFolders,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    moveNote,
    setProperty,
    trashedIds: () => trashed,
    keptIds: () => new Set([...trashed, ...missing.keys()]),
    missingIds: () => new Set(missing.keys()),
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
