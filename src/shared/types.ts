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

/** On-disk shape of notes.json in the app's userData folder. */
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

/** What the preload script exposes to the renderer as `window.notesApi`. */
export interface NotesApi {
  load(): Promise<NotesFile>;
  save(file: NotesFile): Promise<void>;
  /**
   * Called when the window is about to close. Return the current file if there
   * are unsaved edits, or null when everything is already on disk.
   */
  onFlushRequest(fn: () => NotesFile | null): void;
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
  setSettings(next: Settings): Promise<Settings & { hotkeyFailed: boolean }>;
  /** Called when the tray's "New note" item is chosen. */
  onNewNote(fn: () => void): void;
  /** Every kept version of one note, newest first, without their bodies. */
  historyList(noteId: string): Promise<SnapshotSummary[]>;
  /** One kept version in full, by the moment it was taken. */
  historyGet(noteId: string, at: number): Promise<Snapshot | null>;
  /**
   * Keeps the note as it stands right now, whatever the usual gap would say.
   * Restoring calls this first, so going back is itself something to go back from.
   */
  historyKeep(note: Note): Promise<void>;
  /** Puts text on the system clipboard. */
  copyText(text: string): Promise<void>;
}

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}
