import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { installCli, layoutFor, shimStatus, uninstallCli } from '../core/shim';
import { IPC } from '../shared/channels';
import { folderLabel, parentFolder } from '../shared/folders';
import type { CliStatus, ExportRequest, FolderResult, Note, NotesFile } from '../shared/types';
import type { Settings } from '../shared/settings';
import { attachments, installAssetProtocol, pickAttachments, registerAssetScheme, saveAttachment, sweepOrphans } from './attachments';
import { destroyCapture, hideCapture, showCapture, toggleCapture } from './capture';
import { installContextMenu } from './context-menu';
import { startClipper, type Clipper } from './clipper';
import { currentNotesFolder, pickNotesFolder, restartForFolder } from './notes-folder';
import { bookmarklet } from '../shared/clipper';
import { exportNote, exportTo } from './export';
import { forgetHistory, getSnapshot, history, keepNow, listHistory, record } from './history-store';
import { pickImports } from './import';
import { createReminders, type Reminders } from './reminders';
import { startIpcServer, type IpcServer } from './ipc-server';
import {
  createFolder,
  deleteFolder,
  expireTrash,
  getTrashed,
  keptIds,
  listFolders,
  listTrash,
  moveFolder,
  moveNote,
  renameFolder,
  trashBodies,
  drain,
  loadNotes,
  notesDir,
  purgeTrashed,
  restoreFromTrash,
  saveNotes,
  stopWatching,
  store,
  watchNotes,
} from './notes-store';
import { loadSettings, saveSettings, settings, settingsStore } from './settings';
import { handleSquirrelEvent } from './squirrel';
import { applyHotkey, createTray, destroyTray, releaseHotkeys, showWindow, toggleWindow } from './tray';

// Squirrel runs the exe with install/update flags; those launches do their
// housekeeping (shortcuts, the `notes` command) and exit.
const squirrelLaunch = handleSquirrelEvent();

const BG = '#121722';

/**
 * One folder command, answered the same way whichever it was: what it ended
 * at, every folder there is now, and a sentence. A refusal is an answer too —
 * a folder name Windows will not keep is the user's to fix, not a crash for
 * the window to catch.
 */
async function folderResult(run: () => Promise<string>, said: (folder: string) => string): Promise<FolderResult> {
  try {
    const folder = await run();
    return { ok: true, folder, folders: await listFolders(), message: said(folder) };
  } catch (err) {
    return { ok: false, folder: '', folders: await listFolders().catch(() => []), message: err instanceof Error ? err.message : String(err) };
  }
}

/** The scheme launchers can use: notes://open?id=…, notes://new?text=…, notes://inbox?text=… */
const URI_SCHEME = 'notes';

// A packaged build takes its taskbar icon from the executable. In dev the
// executable is electron.exe, so point at the source icon instead.
function devIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(__dirname, '../../assets/icon.ico');
  return fs.existsSync(icon) ? icon : undefined;
}

function isExternal(url: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(url);
}

// Closing the window can mean "hide to the tray", so a real quit has to say so.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BG,
    title: 'Notes',
    icon: devIcon(),
    autoHideMenuBar: true,
    // Native caption buttons drawn over our own header, so the chrome stays
    // minimal without re-implementing minimise/maximise/close.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#a3a9b6', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  // The quick-note box is a window too, so 'window-all-closed' would wait on
  // it; the notes window going away is what ends the app.
  win.on('closed', () => {
    mainWin = null;
    app.quit();
  });

  installContextMenu(win);

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // Links inside rendered markdown open in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isExternal(url)) void shell.openExternal(url);
  });

  // Give the renderer one chance to hand over unsaved edits before the window
  // goes away. Autosave is debounced, so the last 300 ms of typing lives here.
  let flushed = false;
  win.on('close', (event) => {
    // Hiding to the tray leaves the renderer alive, so its own autosave keeps
    // working; only ask for the last few hundred milliseconds and stay open.
    if (settings().closeToTray && !quitting) {
      event.preventDefault();
      requestFlush(win);
      win.hide();
      return;
    }
    if (flushed) return;
    event.preventDefault();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      flushed = true;
      ipcMain.removeListener(IPC.flushReply, onReply);
      win.destroy();
    };
    const onReply = async (_event: Electron.IpcMainEvent, file: NotesFile | null) => {
      clearTimeout(timer);
      if (file) await persist(file).catch((err) => console.error('[notes] flush on close failed', err));
      finish();
    };
    const timer = setTimeout(finish, 1500);
    ipcMain.once(IPC.flushReply, onReply);
    win.webContents.send(IPC.flushRequest);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return win;
}

/** Asks the renderer for anything unsaved without waiting on the answer. */
function requestFlush(win: BrowserWindow): void {
  ipcMain.once(IPC.flushReply, (_event, file: NotesFile | null) => {
    if (file) void persist(file).catch((err) => console.error('[notes] flush to tray failed', err));
  });
  win.webContents.send(IPC.flushRequest);
}

function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('no window for request');
  return win;
}

/** The notes window, once it exists. The capture box, the tray and the command line talk to it. */
let mainWin: BrowserWindow | null = null;
let ipcServer: IpcServer | null = null;
let reminders: Reminders | null = null;
/** The web clipper's receiver, while the app is up. */
let clipper: Clipper | null = null;
/** The notes as last loaded or saved, for anything in main that needs them without a read of the folder. */
let lastNotes: Note[] = [];

/**
 * Writes the notes and does what follows a write — reminders brought up to
 * date, a snapshot taken, orphaned attachments swept — whether the save came
 * on the timer, on the way to the tray, or on closing.
 */
async function persist(file: NotesFile): Promise<void> {
  await saveNotes(file);
  lastNotes = file.notes;
  reminders?.update(file.notes);
  // Both run behind the save, never in front of it: neither the snapshot
  // ring nor the attachment sweep may delay or endanger the write itself.
  void record(file.notes, keptIds());
  void sweepOrphans(file, trashBodies).catch((err) => console.error('[notes] attachment sweep failed', err));
}

/** Brings the window up at a note: from a reminder, or a notes:// link. */
function openNoteInWindow(id: string): void {
  if (mainWin) showWindow(mainWin);
  void ipcServer?.ask('open', { id }).catch((err) => console.error('[notes] could not open the note', err));
}

/** Registers both system-wide chords; returns which of them could not be. */
function applyHotkeys(): { hotkeyFailed: boolean; captureHotkeyFailed: boolean } {
  const s = settings();
  releaseHotkeys();
  const summon = applyHotkey('summon', s.hotkey, () => {
    if (mainWin) toggleWindow(mainWin);
  });
  const capture = applyHotkey('capture', s.captureHotkey, toggleCapture);
  return { hotkeyFailed: s.hotkey !== null && !summon, captureHotkeyFailed: s.captureHotkey !== null && !capture };
}

/** Stores settings and applies them: from the sheet, or from the command line. */
async function applySettings(next: Settings, fromWindow: boolean): Promise<Settings & { hotkeyFailed: boolean; captureHotkeyFailed: boolean }> {
  const stored = await saveSettings(next);
  const result = { ...stored, ...applyHotkeys() };
  // Turning reminders on or off takes effect at once — from the notes as last
  // loaded or saved, not a fresh read of the folder: a file found by such a
  // read would reach the store without the window hearing of it.
  reminders?.update(lastNotes);
  if (!fromWindow && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.settingsChanged, stored);
  return result;
}

// --- the `notes` command ---------------------------------------------------------

function cliLayout() {
  return layoutFor(path.dirname(process.execPath));
}

function cliStatus(): CliStatus {
  if (!app.isPackaged) return { available: false, installed: false, onPath: false, binDir: '', current: false };
  const s = shimStatus(cliLayout());
  return { available: true, installed: s.installed, onPath: s.onPath, binDir: s.binDir, current: s.current };
}

// --- notes:// links -----------------------------------------------------------------

/** A launcher's request: notes://open?id=…, notes://new?text=…, notes://inbox?text=… */
function handleUri(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== `${URI_SCHEME}:`) return;
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase();
  const text = url.searchParams.get('text') ?? '';
  const id = url.searchParams.get('id') ?? undefined;
  const search = url.searchParams.get('search') ?? url.searchParams.get('q') ?? undefined;
  if (!ipcServer) return;
  const win = mainWin;
  if (win) showWindow(win);
  const ask = ipcServer.ask;
  switch (action) {
    case 'open':
      void ask('open', { id, search }).catch((err) => console.error('[notes] notes://open failed', err));
      break;
    case 'new': {
      const note: Note = { id: crypto.randomUUID(), body: text, createdAt: Date.now(), updatedAt: Date.now() };
      void ask('note.put', { note, force: false })
        .then(() => ask('open', { id: note.id }))
        .catch((err) => console.error('[notes] notes://new failed', err));
      break;
    }
    case 'inbox':
      if (text.trim()) void ask('inbox', { text }).catch((err) => console.error('[notes] notes://inbox failed', err));
      break;
    default:
      break;
  }
}

const uriIn = (argv: string[]): string | undefined => argv.find((a) => a.toLowerCase().startsWith(`${URI_SCHEME}://`));

if (squirrelLaunch) {
  // On its way out.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAssetScheme();
  // No application menu: its default accelerators (Ctrl+Shift+I, Ctrl+R...)
  // would shadow the app's own shortcuts. F12 still opens DevTools.
  Menu.setApplicationMenu(null);

  // A second launch only wakes this one — and hands over a notes:// link if
  // it carried one. Its argv is not a channel for anything else: the command
  // line uses the pipe.
  app.on('second-instance', (_event, argv) => {
    if (mainWin) showWindow(mainWin);
    const uri = uriIn(argv);
    if (uri) handleUri(uri);
  });

  let housekept = false;
  ipcMain.handle(IPC.notesLoad, async (event) => {
    const file = await loadNotes();
    // The folder exists now, so it can be watched; and the trash can be
    // emptied of what has waited long enough. Once per launch, behind the load.
    if (!housekept) {
      housekept = true;
      const win = windowFor(event);
      reminders = createReminders({ userData: app.getPath('userData'), enabled: () => settings().reminders, openNote: openNoteInWindow });
      watchNotes((changes) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.externalChange, changes);
        reminders?.applyChanges(changes);
      });
      // Everything the store does, not only what the watcher notices: the
      // command line can file a note in another folder while the window is
      // open, and the file moves without its text changing, so the watcher
      // has nothing to report. The window compares before it takes anything
      // in, so its own writes come back to it as nothing at all.
      store.onChange((changes) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.externalChange, changes);
      });
      void expireTrash()
        .then((gone) => Promise.all(gone.map(forgetHistory)))
        .catch((err) => console.error('[notes] emptying the trash failed', err));
    }
    lastNotes = file.notes;
    reminders?.update(file.notes);
    return file;
  });
  ipcMain.handle(IPC.notesSave, (_event, file: NotesFile) => persist(file));
  ipcMain.handle(IPC.openFolder, () => shell.openPath(notesDir()).then(() => undefined));
  ipcMain.handle(IPC.showNoteFile, (_event, id: string) => {
    const rel = store.fileNameOf(id);
    if (!rel) return false;
    // Explorer with the file itself picked out, rather than the folder it is
    // in: the question "where does this note live" is about the note.
    shell.showItemInFolder(path.join(notesDir(), ...rel.split('/')));
    return true;
  });
  ipcMain.handle(IPC.foldersList, () => listFolders());
  ipcMain.handle(IPC.folderCreate, (_event, folder: string) => folderResult(() => createFolder(folder), (made) => `Made ${folderLabel(made)}`));
  ipcMain.handle(IPC.folderRename, (_event, folder: string, name: string) =>
    folderResult(
      () => renameFolder(folder, name),
      (now) => `Renamed to ${folderLabel(now)}`,
    ),
  );
  ipcMain.handle(IPC.folderMove, (_event, folder: string, into: string) =>
    folderResult(
      () => moveFolder(folder, into),
      (now) => `Moved to ${folderLabel(now)}`,
    ),
  );
  ipcMain.handle(IPC.folderDelete, (_event, folder: string) =>
    folderResult(
      async () => {
        await deleteFolder(folder);
        return parentFolder(folder);
      },
      () => `Deleted ${folderLabel(folder)}`,
    ),
  );
  ipcMain.handle(IPC.noteMove, (_event, id: string, folder: string) =>
    folderResult(
      async () => {
        await moveNote(id, folder);
        return folder;
      },
      (now) => `Filed in ${folderLabel(now)}`,
    ),
  );
  ipcMain.handle(IPC.notesFolder, () => currentNotesFolder());
  ipcMain.handle(IPC.clipperBookmarklet, () => (clipper ? bookmarklet(clipper.port, clipper.token) : null));
  ipcMain.handle(IPC.pickNotesFolder, async (event) => {
    // Everything on screen goes to disk first: the files are about to move,
    // and words still in the window would be written to the old place.
    requestFlush(windowFor(event));
    await drain();
    const change = await pickNotesFolder(windowFor(event));
    if (change?.restart) setTimeout(restartForFolder, 1200);
    return change;
  });
  ipcMain.handle(IPC.attach, (_event, bytes: Uint8Array, name: string) => saveAttachment(bytes, name));
  ipcMain.handle(IPC.pickAttachments, (event) => pickAttachments(windowFor(event)));
  ipcMain.handle(IPC.pickImports, (event) => pickImports(windowFor(event)));
  ipcMain.handle(IPC.exportNote, (event, request: ExportRequest) => exportNote(windowFor(event), request));
  ipcMain.handle(IPC.exportNoteTo, (_event, target: string, request: ExportRequest) => exportTo(target, request));
  ipcMain.handle(IPC.historyList, (_event, noteId: string) => listHistory(noteId));
  ipcMain.handle(IPC.historyGet, (_event, noteId: string, at: number) => getSnapshot(noteId, at));
  ipcMain.handle(IPC.historyKeep, (_event, note: Note) => keepNow(note));
  ipcMain.handle(IPC.trashList, () => listTrash());
  ipcMain.handle(IPC.trashGet, (_event, id: string) => getTrashed(id));
  ipcMain.handle(IPC.trashRestore, (_event, id: string) => restoreFromTrash(id));
  ipcMain.handle(IPC.trashPurge, async (_event, id: string) => {
    const gone = await purgeTrashed(id);
    if (gone) await forgetHistory(id);
    return gone;
  });
  ipcMain.handle(IPC.copyText, (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle(IPC.settingsGet, () => settings());
  ipcMain.handle(IPC.settingsSet, (_event, next: Settings) => applySettings(next, true));
  ipcMain.handle(IPC.cliStatus, () => cliStatus());
  ipcMain.handle(IPC.cliInstall, () => {
    if (app.isPackaged) installCli(cliLayout());
    return cliStatus();
  });
  ipcMain.handle(IPC.cliUninstall, () => {
    if (app.isPackaged) uninstallCli(cliLayout());
    return cliStatus();
  });

  // The quick-note box hands its text to the notes window, which owns the
  // notes, and goes away either way.
  ipcMain.handle(IPC.captureSend, (_event, text: string) => {
    hideCapture();
    if (mainWin && !mainWin.isDestroyed() && typeof text === 'string' && text.trim()) mainWin.webContents.send(IPC.captured, text);
  });
  ipcMain.handle(IPC.captureDismiss, () => hideCapture());

  void app.whenReady().then(async () => {
    installAssetProtocol();
    await loadSettings();
    const win = createWindow();
    mainWin = win;
    createTray(win, {
      newNote: () => {
        showWindow(win);
        win.webContents.send(IPC.newNote);
      },
      quickNote: showCapture,
    });
    applyHotkeys();
    if (app.isPackaged) app.setAsDefaultProtocolClient(URI_SCHEME);
    try {
      ipcServer = await startIpcServer({
        userData: app.getPath('userData'),
        version: app.getVersion(),
        store,
        history,
        settings: settingsStore,
        attachments,
        window: () => mainWin,
        applySettings: (next) => applySettings(next, false),
        showWindow: () => {
          if (mainWin) showWindow(mainWin);
        },
        showCapture,
        notify: (title, body, noteId) => reminders?.show(title, body, noteId) ?? false,
      });
    } catch (err) {
      console.error('[notes] the command line cannot reach this instance', err);
    }
    // The web clipper's receiver. A failure here is not worth stopping for:
    // everything else about the app works without it.
    try {
      clipper = await startClipper({
        log: (message) => console.error(message),
        clip: async (title, text) => {
          if (!ipcServer) throw new Error('the window is not listening yet');
          const note: Note = { id: crypto.randomUUID(), body: text, createdAt: Date.now(), updatedAt: Date.now(), ...(title ? { title } : {}) };
          await ipcServer.ask('note.put', { note, force: false });
        },
      });
    } catch (err) {
      console.error('[notes] the web clipper could not listen', err);
    }
    // Launched by a notes:// link: act on it once the window can answer.
    const uri = uriIn(process.argv);
    if (uri) win.webContents.once('did-finish-load', () => setTimeout(() => handleUri(uri), 300));
  });

  app.on('window-all-closed', () => app.quit());
  let drained = false;
  app.on('will-quit', (event) => {
    globalShortcut.unregisterAll();
    clipper?.stop();
    stopWatching();
    reminders?.stop();
    destroyCapture();
    destroyTray();
    if (drained) return;
    drained = true;
    // The last save may still be on its way to the disk — the window answers
    // a flush with nothing while its own save is in flight — and ipc.json
    // must not outlive the process that wrote it. Quit once both are settled.
    event.preventDefault();
    const server = ipcServer;
    ipcServer = null;
    const settled = Promise.all([server?.close(), drain()]);
    const atMost = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    void Promise.race([settled, atMost]).finally(() => app.quit());
  });
}
