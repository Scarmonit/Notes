import path from 'node:path';
import { createNote, linkKey, titleOf, updateBody } from '../renderer/notes';
import type { Snapshot, SnapshotSummary } from '../shared/history';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, Note, SettingsResult, TrashedNote } from '../shared/types';
import { createAttachments, type Attachments } from './attachments';
import { CliError, NeedsAppError, type Backend } from './backend';
import { createHistory, type History } from './history';
import { renderHtmlOffline } from './render';
import { EXIT, type CommandInfo, type NoteStatus, type PathsInfo, type UiState } from './ipc-protocol';
import { pathsFor } from './paths';
import { applyPlanTo, checkPlan } from './refactor';
import { createSettings, type SettingsStore } from './settings';
import { createStore, type Store } from './store';

/**
 * The notes worked directly from their files, for when the app is not
 * running. Every write goes through the same store the app uses, so the
 * files come out byte-for-byte as the app would have written them, and the
 * app's watcher, next time it runs or if it starts meanwhile, takes them as
 * a sync tool's changes.
 */

export const INBOX_TITLE = 'Inbox';

/** The same paragraph rule as the capture box: a blank line, then the text. */
export function appendParagraph(body: string, text: string): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return body;
  return body.trimEnd() ? `${body.trimEnd()}\n\n${clean}` : clean;
}

export interface FileBackendOptions {
  /** The command line's own version, reported where an app's would be. */
  version: string;
}

export function createFileBackend(root: string, options: FileBackendOptions): Backend {
  const paths = pathsFor(root);
  const store: Store = createStore(root);
  const history: History = createHistory(root);
  const settings: SettingsStore = createSettings(root);
  const attachments: Attachments = createAttachments(root);

  let loaded: Note[] | null = null;

  async function all(): Promise<Note[]> {
    if (!loaded) loaded = (await store.loadNotes()).notes;
    return loaded;
  }

  /** Writes the list, then records history under the app's own rule. */
  async function commit(next: Note[]): Promise<void> {
    await store.saveNotes({ version: 1, notes: next });
    loaded = next;
    // The trash has not been read, so its ids are unknown here: no sweep.
    await history.record(next, store.trashedIds(), { sweep: false });
  }

  const notFound = (id: string): CliError => new CliError(`No note with id ${id}`, EXIT.notFound);

  return {
    mode: 'file',
    version: options.version,

    paths: async (): Promise<PathsInfo> => ({
      root: paths.root,
      notes: paths.notes,
      trash: paths.trash,
      history: paths.history,
      attachments: paths.attachments,
      settings: paths.settings,
    }),
    notes: () => all().then((n) => [...n]),
    get: async (id) => (await all()).find((n) => n.id === id) ?? null,
    status: async (): Promise<NoteStatus> => ({ open: false, dirty: false }),
    fileOf: async (id) => {
      await all();
      const rel = store.fileNameOf(id);
      return rel ? path.join(paths.notes, ...rel.split('/')) : null;
    },

    folderList: () => store.listFolders(),
    folderCreate: (folder) => store.createFolder(folder),
    folderRename: (folder, name) => store.renameFolder(folder, name),
    folderMove: (folder, into) => store.moveFolder(folder, into),
    folderDelete: (folder) => store.deleteFolder(folder),
    noteMove: async (id, folder) => {
      // The index is what knows where a note is; a store that has not read the
      // folder yet knows nothing about any note.
      await all();
      return store.moveNote(id, folder);
    },
    put: async (note, options) => {
      const notes = await all();
      const i = notes.findIndex((n) => n.id === note.id);
      if (i >= 0 && options?.expectUpdatedAt !== undefined && notes[i].updatedAt !== options.expectUpdatedAt && !options.force) {
        throw new CliError(`"${titleOf(notes[i])}" changed since it was read; pass --force to replace it anyway`, EXIT.busy);
      }
      const next = i < 0 ? [note, ...notes] : notes.map((n) => (n.id === note.id ? note : n));
      await commit(next);
      return note;
    },
    remove: async (id) => {
      const notes = await all();
      if (!notes.some((n) => n.id === id)) return false;
      await commit(notes.filter((n) => n.id !== id));
      return true;
    },
    inbox: async (text) => {
      const notes = await all();
      let inbox = notes.find((n) => linkKey(titleOf(n)) === linkKey(INBOX_TITLE));
      let next = notes;
      if (!inbox) {
        inbox = createNote();
        inbox.title = INBOX_TITLE;
        next = [inbox, ...notes];
      }
      next = updateBody(next, inbox.id, appendParagraph(inbox.body, text));
      await commit(next);
      return inbox.id;
    },

    applyPlan: async (plan) => {
      const notes = await all();
      const check = checkPlan(plan, notes);
      if (!check.ok) throw new CliError(check.message, EXIT.failure);
      if (plan.restore.length > 0) throw new NeedsAppError('Putting a note back as part of a change');
      const touched = [...plan.writes.map((w) => w.id), ...plan.trash.map((t) => t.id)];
      try {
        await commit(applyPlanTo(plan, notes));
      } catch (err) {
        // The store writes one file at a time: say which ones made it.
        loaded = null;
        const now = await all();
        const written = plan.writes.filter((w) => now.find((n) => n.id === w.id)?.body === w.after.body).map((w) => w.id);
        const trashed = plan.trash.filter((t) => !now.some((n) => n.id === t.id)).map((t) => t.id);
        const done = [...written, ...trashed];
        throw new CliError(`${(err as Error).message}; ${done.length === 0 ? 'nothing was written' : `written so far: ${done.join(', ')}`}`, EXIT.failure);
      }
      return { applied: touched };
    },

    trashList: (): Promise<TrashedNote[]> => store.listTrash(),
    trashGet: (id) => store.getTrashed(id),
    trashRestore: async (id) => {
      const note = await store.restoreFromTrash(id);
      if (note && loaded) loaded = [note, ...loaded.filter((n) => n.id !== note.id)];
      return note;
    },
    trashPurge: async (id) => {
      const gone = await store.purgeTrashed(id);
      if (gone) await history.forgetHistory(id);
      return gone;
    },

    historyList: (id): Promise<SnapshotSummary[]> => history.listHistory(id),
    historyGet: (id, at): Promise<Snapshot | null> => history.getSnapshot(id, at),
    historyKeep: async (id) => {
      const note = (await all()).find((n) => n.id === id);
      if (!note) throw notFound(id);
      await history.keepNow(note);
      return true;
    },
    historyRestore: async (id, at) => {
      const notes = await all();
      const note = notes.find((n) => n.id === id);
      if (!note) throw notFound(id);
      const snap = await history.getSnapshot(id, at);
      if (!snap) throw new CliError(`No version of the note from ${new Date(at).toISOString()}`, EXIT.notFound);
      // Keep what is there now first, so going back is itself something to go back from.
      await history.keepNow(note);
      const { title: _old, ...rest } = note;
      const restored: Note = snap.title ? { ...rest, title: snap.title, body: snap.body, updatedAt: Date.now() } : { ...rest, body: snap.body, updatedAt: Date.now() };
      await commit(notes.map((n) => (n.id === id ? restored : n)));
      return restored;
    },

    attach: (bytes, name) => attachments.saveAttachment(bytes, name),

    settingsGet: (): Promise<Settings> => settings.loadSettings(),
    settingsSet: async (next): Promise<SettingsResult> => {
      const stored = await settings.saveSettings(next);
      // Whether the chords register is only known to a running app.
      return { ...stored, hotkeyFailed: false, captureHotkeyFailed: false };
    },

    uiGet: (): Promise<UiState> => Promise.reject(new NeedsAppError('Reading the layout')),
    uiSet: () => Promise.reject(new NeedsAppError('Changing the layout')),
    commands: (): Promise<CommandInfo[]> => Promise.reject(new NeedsAppError('Listing the window commands')),
    run: () => Promise.reject(new NeedsAppError('Running a window command')),
    open: () => Promise.reject(new NeedsAppError('Opening the window')),
    captureShow: () => Promise.reject(new NeedsAppError('The quick-note box')),
    exportRendered: (_id, _path, kind) => Promise.reject(new NeedsAppError(kind === 'png' ? 'Rendering a PNG' : kind === 'pdf' ? 'Rendering a PDF' : 'Drawing the diagrams of an HTML page')),
    renderHtml: async (body) => renderHtmlOffline(body, await all()),
    notify: () => Promise.reject(new NeedsAppError('A notification')),

    watch: async (onChange, signal) => {
      await all();
      store.watchNotes(() => undefined);
      const off = store.onChange((changes: ExternalChanges) => onChange(changes));
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      off();
      store.stopWatching();
    },

    close: async () => {
      store.stopWatching();
    },
  };
}
