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
  /** Shows a Save dialog and writes the export; resolves to the path, or null if cancelled. */
  exportNote(request: ExportRequest): Promise<string | null>;
}

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}
