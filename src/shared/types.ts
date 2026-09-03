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
}

/** One markdown or text file chosen for import, read as text. */
export interface ImportedFile {
  name: string;
  text: string;
}

export type ExportKind = 'md' | 'txt' | 'png';

/** What the renderer hands the main process for each export format. */
export type ExportRequest =
  | { kind: 'md'; title: string; body: string }
  | { kind: 'txt'; title: string; text: string }
  | { kind: 'png'; title: string; html: string; css: string; edited: string };

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
