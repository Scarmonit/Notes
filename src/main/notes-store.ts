import { app } from 'electron';
import { createStore } from '../core/store';

/**
 * The app's one store, on Electron's userData folder. Everything about the
 * files themselves lives in core/store.ts, which the command line shares;
 * this is just the instance the main process uses.
 */
export const store = createStore(app.getPath('userData'));

export const notesDir = (): string => store.notesDir;
export const trashDir = (): string => store.trashDir;
export const {
  loadNotes,
  saveNotes,
  trashedIds,
  keptIds,
  missingIds,
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  moveNote,
  setProperty,
  listTrash,
  getTrashed,
  restoreFromTrash,
  purgeTrashed,
  expireTrash,
  trashBodies,
  drain,
  watchNotes,
  stopWatching,
} = store;
export { TRASH_AGE_MS } from '../core/store';
