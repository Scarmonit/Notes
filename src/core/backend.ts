import type { Snapshot, SnapshotSummary } from '../shared/history';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, Note, SettingsResult, TrashedNote } from '../shared/types';
import { EXIT, type CommandInfo, type ExitCode, type NoteStatus, type PathsInfo, type UiState } from './ipc-protocol';
import type { Plan } from './refactor';

/**
 * What a command needs from the notes, whichever side holds them. When the
 * app is not running the command line works the files itself through the
 * core stores; when it is, the app is the single writer and every call goes
 * to it over the pipe. Commands are written once against this and never
 * know which.
 */
export interface Backend {
  readonly mode: 'file' | 'app';
  /** The app's version when connected to one; the command line's own otherwise. */
  readonly version: string;

  paths(): Promise<PathsInfo>;
  notes(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  status(id: string): Promise<NoteStatus>;
  /** The file a note is stored in, or null when it has not been written yet. */
  fileOf(id: string): Promise<string | null>;

  /** Every folder in the notebook, root-relative, empty ones included. */
  folderList(): Promise<string[]>;
  /** Makes a folder and every folder above it; resolves to the one it made. */
  folderCreate(folder: string): Promise<string>;
  /** Changes a folder's own name; resolves to its new path. */
  folderRename(folder: string, name: string): Promise<string>;
  /** Puts a folder inside another; resolves to its new path. */
  folderMove(folder: string, into: string): Promise<string>;
  /** Removes a folder that holds nothing. */
  folderDelete(folder: string): Promise<void>;
  /** Files a note in another folder; resolves to its path inside the notes folder. */
  noteMove(id: string, folder: string): Promise<string>;
  /**
   * Creates or replaces a note. Throws `busy` while the note is being typed
   * in, or when `expectUpdatedAt` is given and the note has changed since it
   * was read at that moment (words typed in the window while an editor was
   * open), unless forced.
   */
  put(note: Note, options?: { force?: boolean; expectUpdatedAt?: number }): Promise<Note>;
  /** Moves a note to the trash. */
  remove(id: string, options?: { force?: boolean }): Promise<boolean>;
  /** Files a quick note in the Inbox, the capture box's way. Resolves to the Inbox note's id. */
  inbox(text: string): Promise<string>;
  /**
   * Applies a refactoring Plan: every note it names checked against the Plan
   * first (a stale Plan is refused whole, and `force` cannot override that),
   * then each written once and the trashed ones trashed last. Resolves to the
   * ids that were changed. Throws `busy` while a touched note is being typed
   * in the window, unless forced.
   */
  applyPlan(plan: Plan, options?: { force?: boolean }): Promise<{ applied: string[] }>;

  trashList(): Promise<TrashedNote[]>;
  trashGet(id: string): Promise<Note | null>;
  trashRestore(id: string): Promise<Note | null>;
  trashPurge(id: string): Promise<boolean>;

  historyList(id: string): Promise<SnapshotSummary[]>;
  historyGet(id: string, at: number): Promise<Snapshot | null>;
  historyKeep(id: string): Promise<boolean>;
  historyRestore(id: string, at: number, options?: { force?: boolean }): Promise<Note>;

  /** Stores image bytes; resolves to their note-asset URL. */
  attach(bytes: Uint8Array, name: string): Promise<string>;

  settingsGet(): Promise<Settings>;
  settingsSet(next: Settings): Promise<SettingsResult>;

  // The window's own: only an app can answer these.
  uiGet(): Promise<UiState>;
  uiSet(key: string, value: boolean | number | string | null): Promise<UiState>;
  commands(): Promise<CommandInfo[]>;
  run(id: string): Promise<boolean>;
  open(options: { id?: string; search?: string }): Promise<boolean>;
  captureShow(): Promise<boolean>;
  /** Writes the preview on a page: a png, a pdf, or a standalone html file. */
  exportRendered(id: string, path: string, kind: 'png' | 'pdf' | 'html'): Promise<void>;
  renderHtml(body: string): Promise<string>;
  /** Shows a Windows notification through the app, as a reminder would. */
  notify(title: string, body: string, noteId?: string): Promise<boolean>;

  /** Streams changes until the signal fires. */
  watch(onChange: (changes: ExternalChanges) => void, signal: AbortSignal): Promise<void>;

  close(): Promise<void>;
}

/** An error that already knows which exit code it deserves. */
export class CliError extends Error {
  readonly exit: ExitCode;
  readonly candidates?: Array<{ id: string; title: string; path?: string }>;
  constructor(message: string, exit: ExitCode = EXIT.failure, candidates?: Array<{ id: string; title: string; path?: string }>) {
    super(message);
    this.name = 'CliError';
    this.exit = exit;
    this.candidates = candidates;
  }
}

/** Raised by file mode for anything only the window can do. */
export class NeedsAppError extends CliError {
  constructor(what: string) {
    super(`${what} needs the Notes window; start Notes, or drop --no-app`, EXIT.noApp);
    this.name = 'NeedsAppError';
  }
}
