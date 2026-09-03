import path from 'node:path';

/**
 * Where everything lives, from one root: the app's userData folder. The
 * main process hands over `app.getPath('userData')`; the command line, which
 * runs as plain Node with no `electron` module, works the folder out the
 * same way Electron does — `%APPDATA%\Notes`, or whatever `--user-data-dir`
 * says — so both sides always read and write the same files.
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
}

export function pathsFor(root: string): Paths {
  return {
    root,
    notes: path.join(root, 'notes'),
    trash: path.join(root, 'trash'),
    history: path.join(root, 'history'),
    attachments: path.join(root, 'attachments'),
    settings: path.join(root, 'settings.json'),
    legacy: path.join(root, 'notes.json'),
    ipc: path.join(root, 'ipc.json'),
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
