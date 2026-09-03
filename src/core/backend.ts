import type { Snapshot, SnapshotSummary } from '../shared/history';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, Note, SettingsResult, TrashedNote } from '../shared/types';
import { EXIT, type CommandInfo, type ExitCode, type NoteStatus, type PathsInfo, type UiState } from './ipc-protocol';

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
  /** Creates or replaces a note. Throws `busy` while the note is being typed in, unless forced. */
  put(note: Note, options?: { force?: boolean }): Promise<Note>;
  /** Moves a note to the trash. */
  remove(id: string, options?: { force?: boolean }): Promise<boolean>;
  /** Files a quick note in the Inbox, the capture box's way. Resolves to the Inbox note's id. */
  inbox(text: string): Promise<string>;

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
  exportPng(id: string, path: string): Promise<void>;
  renderHtml(body: string): Promise<string>;

  /** Streams changes until the signal fires. */
  watch(onChange: (changes: ExternalChanges) => void, signal: AbortSignal): Promise<void>;

  close(): Promise<void>;
}

/** An error that already knows which exit code it deserves. */
export class CliError extends Error {
  readonly exit: ExitCode;
  readonly candidates?: Array<{ id: string; title: string }>;
  constructor(message: string, exit: ExitCode = EXIT.failure, candidates?: Array<{ id: string; title: string }>) {
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
