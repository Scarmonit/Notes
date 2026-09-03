export interface Note {
  id: string;
  /** Raw markdown. The title is derived from the first non-empty line. */
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** On-disk shape of notes.json in the app's userData folder. */
export interface NotesFile {
  version: 1;
  notes: Note[];
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
}

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}
