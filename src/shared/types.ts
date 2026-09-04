import type { Snapshot, SnapshotSummary } from './history';
import type { Settings } from './settings';

export interface Note {
  id: string;
  /** Raw markdown. The title is derived from the first non-empty line. */
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Pinned notes sort above the rest, whatever their edit time. */
  pinned?: boolean;
  /** An explicit title. Without one, the first non-empty line of the body stands in. */
  title?: string;
}

/**
 * The notes as the renderer and the main process pass them back and forth.
 * On disk they are a folder of markdown files (see shared/notes-folder.ts);
 * this was also the shape of the single notes.json before 0.11, which is why
 * it still carries a version.
 */
export interface NotesFile {
  version: 1;
  notes: Note[];
  /**
   * The `seq` of the last change from outside the caller has taken in. A
   * note the store found after that is missing from the list only because
   * the caller has not heard of it yet, not because it was deleted.
   */
  seen?: number;
}

/** One markdown or text file chosen for import, read as text. */
export interface ImportedFile {
  name: string;
  text: string;
}

export type ExportKind = 'md' | 'txt' | 'png' | 'html' | 'pdf';

/** The three exports that are the preview laid on a page: the window renders, the main process writes. */
export interface RenderedExport {
  title: string;
  /** The rendered, sanitised article, diagrams drawn. */
  html: string;
  /** The app's stylesheet, inlined. */
  css: string;
  /** KaTeX's stylesheet with its fonts inlined, when the note has math. */
  mathCss?: string;
  edited: string;
}

/** What the renderer hands the main process for each export format. */
export type ExportRequest =
  | { kind: 'md'; title: string; body: string }
  | { kind: 'txt'; title: string; text: string }
  | ({ kind: 'png' } & RenderedExport)
  | ({ kind: 'html' } & RenderedExport)
  | ({ kind: 'pdf' } & RenderedExport);

/** What the trash lists: enough to choose by, without the whole body. */
export interface TrashedNote {
  id: string;
  title: string;
  /** The first words, collapsed onto one line. */
  preview: string;
  chars: number;
  updatedAt: number;
  deletedAt: number;
}

/** What changed in the notes folder behind the app's back. */
export interface ExternalChanges {
  /** Notes whose files were added or rewritten by something else. */
  upserts: Note[];
  /** Ids whose files went away. */
  removed: string[];
  /** Which change this is, counting up; a save quotes the last one it took in as `seen`. */
  seq: number;
}

/** What the preload script exposes to the renderer as `window.notesApi`. */
export interface NotesApi {
  load(): Promise<NotesFile>;
  save(file: NotesFile): Promise<void>;
  /**
   * Called when the window is about to close. Return the current file if there
   * are unsaved edits, or null when everything is already on disk.
   */
  onFlushRequest(fn: () => NotesFile | null): void;
  /** Called when files in the notes folder were changed by something other than the app. */
  onExternalChange(fn: (changes: ExternalChanges) => void): void;
  /** Opens the notes folder in Explorer. */
  openNotesFolder(): Promise<void>;
  /** Stores image bytes in the attachments folder; resolves to its note-asset:// URL. */
  attach(bytes: Uint8Array, name: string): Promise<string>;
  /** Opens a file picker for images; resolves to the URLs of the ones chosen. */
  pickAttachments(): Promise<string[]>;
  /** Opens a file picker for markdown and text files; resolves to their contents. */
  pickImports(): Promise<ImportedFile[]>;
  /** Shows a Save dialog and writes the export; resolves to the path, or null if cancelled. */
  exportNote(request: ExportRequest): Promise<string | null>;
  /** The tray and hotkey settings the main process is acting on. */
  getSettings(): Promise<Settings>;
  /**
   * Stores new settings and applies them. Resolves to what was stored, with
   * `hotkeyFailed` set when the chord could not be registered system-wide
   * (usually because another application already owns it).
   */
  setSettings(next: Settings): Promise<SettingsResult>;
  /** Called when the tray's "New note" item is chosen. */
  onNewNote(fn: () => void): void;
  /** Called with the text of a quick note taken in the capture box. */
  onCapture(fn: (text: string) => void): void;
  /** Every kept version of one note, newest first, without their bodies. */
  historyList(noteId: string): Promise<SnapshotSummary[]>;
  /** One kept version in full, by the moment it was taken. */
  historyGet(noteId: string, at: number): Promise<Snapshot | null>;
  /**
   * Keeps the note as it stands right now, whatever the usual gap would say.
   * Restoring calls this first, so going back is itself something to go back from.
   */
  historyKeep(note: Note): Promise<void>;
  /** The deleted notes still waiting in the trash, most recent first. */
  trashList(): Promise<TrashedNote[]>;
  /** One trashed note in full. */
  trashGet(id: string): Promise<Note | null>;
  /** Puts a trashed note back among the live ones; resolves to it, or null when it is gone. */
  trashRestore(id: string): Promise<Note | null>;
  /** Removes a trashed note for good. */
  trashPurge(id: string): Promise<boolean>;
  /** Puts text on the system clipboard. */
  copyText(text: string): Promise<void>;
  /** Writes an export to a path the command line chose; no dialog. */
  exportNoteTo(path: string, request: ExportRequest): Promise<void>;
  /** Called when the main process changed the settings on the command line's behalf. */
  onSettingsChanged(fn: (settings: Settings) => void): void;
  /** The `notes` command's launcher: where it is and whether PATH has it. */
  cliStatus(): Promise<CliStatus>;
  cliInstall(): Promise<CliStatus>;
  cliUninstall(): Promise<CliStatus>;
  /**
   * Requests from the command line that only the window can answer: the
   * notes as they stand (unsaved words included), the layout, its commands.
   * The handler's result or error goes back over the pipe.
   */
  onCliRequest(fn: (method: string, params: unknown) => Promise<CliReplyEnvelope>): void;
  /** Tells the main process the note on screen changed, for `notes open --wait`. */
  noteClosed(id: string): void;
}

/**
 * The window's answer to a command-line request. A plain object rather than
 * a thrown error: the context bridge strips everything but the message from
 * an Error, and the exit code has to survive the crossing.
 */
export type CliReplyEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; exit?: number; candidates?: Array<{ id: string; title: string }> } };

/** The `notes` launcher as the Layout sheet reports it. */
export interface CliStatus {
  /** Not a packaged app: nothing can be installed. */
  available: boolean;
  installed: boolean;
  onPath: boolean;
  binDir: string;
  /** current.cmd names this app version. */
  current: boolean;
}

/** What comes back from storing settings: what was kept, and which chords could not be registered. */
export interface SettingsResult extends Settings {
  hotkeyFailed: boolean;
  captureHotkeyFailed: boolean;
}

/** What the capture box's preload exposes as `window.captureApi`. */
export interface CaptureApi {
  /** Sends the text to the inbox note and hides the box. */
  send(text: string): Promise<void>;
  /** Hides the box without sending. */
  dismiss(): Promise<void>;
  /** Called when the box is shown, so the field can be cleared and focused. */
  onShow(fn: () => void): void;
}

declare global {
  interface Window {
    notesApi: NotesApi;
    captureApi: CaptureApi;
  }
}
