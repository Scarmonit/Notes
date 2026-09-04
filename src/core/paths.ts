import fs from 'node:fs';
import path from 'node:path';

/**
 * Where everything lives, from one root: the app's userData folder. The
 * main process hands over `app.getPath('userData')`; the command line, which
 * runs as plain Node with no `electron` module, works the folder out the
 * same way Electron does — `%APPDATA%\Notes`, or whatever `--user-data-dir`
 * says — so both sides always read and write the same files.
 *
 * The notes themselves can be told to live elsewhere — in OneDrive, in a git
 * checkout — with the `notesFolder` setting. That is read HERE, inside
 * `pathsFor`, rather than by each caller: the window and the command line
 * find the notes in the same place because there is only one place that
 * decides where they are. The app's own workings — the settings file, the
 * trash, the snapshots, the pipe — stay in the userData folder, which is the
 * machine's business rather than the notebook's.
 */
export interface Paths {
  root: string;
  notes: string;
  trash: string;
  history: string;
  attachments: string;
  settings: string;
  /** Where notes lived before 0.11: one JSON file. Read once, then set aside. */
  legacy: string;
  /** Written by the running app: how to reach it. */
  ipc: string;
  /** Which task reminders have been shown, so a restart does not show them again. */
  reminded: string;
  /**
   * Notes whose files have gone from the folder without the app deleting them.
   * A sync tool moving a note takes it away and puts it back a moment later,
   * and the app must not take the gap for a deletion; see `store.ts`.
   */
  missing: string;
}

export const SETTINGS_FILE = 'settings.json';

/** Nothing, or a folder path made absolute. */
export function cleanNotesFolder(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

/**
 * The notes folder the settings name, or null for "beside everything else".
 * Read straight off the file, synchronously, because `pathsFor` is called
 * before anything has had a chance to load anything.
 */
const chosen = new Map<string, string | null>();

export function notesFolderFor(root: string): string | null {
  const known = chosen.get(root);
  if (known !== undefined) return known;
  let found: string | null = null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, SETTINGS_FILE), 'utf8'));
    found = raw && typeof raw === 'object' ? cleanNotesFolder((raw as { notesFolder?: unknown }).notesFolder) : null;
  } catch {
    // No settings yet, or unreadable: the notes live in the usual place.
  }
  chosen.set(root, found);
  return found;
}

/** After the folder has been changed, so the next `pathsFor` reads it again. */
export function forgetNotesFolder(root?: string): void {
  if (root === undefined) chosen.clear();
  else chosen.delete(root);
}

export function pathsFor(root: string, notesFolder: string | null = notesFolderFor(root)): Paths {
  // With a folder of its own, a note's pictures live beside it: a notebook
  // put in OneDrive or git has to carry its images or the notes are broken
  // everywhere else.
  const vault = notesFolder ?? null;
  return {
    root,
    notes: vault ?? path.join(root, 'notes'),
    trash: path.join(root, 'trash'),
    history: path.join(root, 'history'),
    attachments: vault ? path.join(vault, 'attachments') : path.join(root, 'attachments'),
    settings: path.join(root, SETTINGS_FILE),
    legacy: path.join(root, 'notes.json'),
    ipc: path.join(root, 'ipc.json'),
    reminded: path.join(root, 'reminded.json'),
    missing: path.join(root, 'missing.json'),
  };
}

/** The value of `--user-data-dir` in an argv, in either of its spellings, or null. */
export function userDataDirArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user-data-dir') return argv[i + 1] ?? null;
    if (arg.startsWith('--user-data-dir=')) return arg.slice('--user-data-dir='.length);
  }
  return null;
}

/** The productName Electron folds into every per-user path. */
export const APP_FOLDER = 'Notes';

/**
 * The userData folder as the app would resolve it: `--user-data-dir` when
 * given, else the per-user application data folder plus the product name.
 */
export function defaultUserData(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = userDataDirArg(argv);
  if (explicit) return path.resolve(explicit);
  const base =
    env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(env.HOME ?? '', 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || path.join(env.HOME ?? '', '.config'));
  return path.join(base, APP_FOLDER);
}
