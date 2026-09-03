import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/channels';
import type { ExportRequest, Note, NotesFile } from '../shared/types';
import type { Settings } from '../shared/settings';
import { installAssetProtocol, pickAttachments, registerAssetScheme, saveAttachment, sweepOrphans } from './attachments';
import { destroyCapture, hideCapture, showCapture, toggleCapture } from './capture';
import { installContextMenu } from './context-menu';
import { exportNote } from './export';
import { forgetHistory, getSnapshot, keepNow, listHistory, record } from './history-store';
import { pickImports } from './import';
import {
  expireTrash,
  getTrashed,
  listTrash,
  loadNotes,
  notesDir,
  purgeTrashed,
  restoreFromTrash,
  saveNotes,
  stopWatching,
  trashedIds,
  watchNotes,
} from './notes-store';
import { loadSettings, saveSettings, settings } from './settings';
import { applyHotkey, createTray, destroyTray, showWindow, toggleWindow } from './tray';

// Squirrel runs the exe with install/update flags; those launches must exit.
if (started) app.quit();

const BG = '#121722';

// A packaged build takes its taskbar icon from the executable. In dev the
// executable is electron.exe, so point at the source icon instead.
function devIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(__dirname, '../../assets/icon.ico');
  return fs.existsSync(icon) ? icon : undefined;
}

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
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
      if (file) await saveNotes(file).catch((err) => console.error('[notes] flush on close failed', err));
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
    if (file) void saveNotes(file).catch((err) => console.error('[notes] flush to tray failed', err));
  });
  win.webContents.send(IPC.flushRequest);
}

function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('no window for request');
  return win;
}

/** The notes window, once it exists. The capture box and the tray talk to it. */
let mainWin: BrowserWindow | null = null;

/** Registers both system-wide chords; returns which of them could not be. */
function applyHotkeys(): { hotkeyFailed: boolean; captureHotkeyFailed: boolean } {
  const s = settings();
  const summon = applyHotkey('summon', s.hotkey, () => {
    if (mainWin) toggleWindow(mainWin);
  });
  const capture = applyHotkey('capture', s.captureHotkey, toggleCapture);
  return { hotkeyFailed: s.hotkey !== null && !summon, captureHotkeyFailed: s.captureHotkey !== null && !capture };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAssetScheme();
  // No application menu: its default accelerators (Ctrl+Shift+I, Ctrl+R...)
  // would shadow the app's own shortcuts. F12 still opens DevTools.
  Menu.setApplicationMenu(null);

  app.on('second-instance', () => {
    if (mainWin) showWindow(mainWin);
  });

  let housekept = false;
  ipcMain.handle(IPC.notesLoad, async (event) => {
    const file = await loadNotes();
    // The folder exists now, so it can be watched; and the trash can be
    // emptied of what has waited long enough. Once per launch, behind the load.
    if (!housekept) {
      housekept = true;
      const win = windowFor(event);
      watchNotes((changes) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.externalChange, changes);
      });
      void expireTrash()
        .then((gone) => Promise.all(gone.map(forgetHistory)))
        .catch((err) => console.error('[notes] emptying the trash failed', err));
    }
    return file;
  });
  ipcMain.handle(IPC.notesSave, async (_event, file: NotesFile) => {
    await saveNotes(file);
    // Both run behind the save, never in front of it: neither the snapshot
    // ring nor the attachment sweep may delay or endanger the write itself.
    void record(file.notes, trashedIds());
    void sweepOrphans(file).catch((err) => console.error('[notes] attachment sweep failed', err));
  });
  ipcMain.handle(IPC.openFolder, () => shell.openPath(notesDir()).then(() => undefined));
  ipcMain.handle(IPC.attach, (_event, bytes: Uint8Array, name: string) => saveAttachment(bytes, name));
  ipcMain.handle(IPC.pickAttachments, (event) => pickAttachments(windowFor(event)));
  ipcMain.handle(IPC.pickImports, (event) => pickImports(windowFor(event)));
  ipcMain.handle(IPC.exportNote, (event, request: ExportRequest) => exportNote(windowFor(event), request));
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
  ipcMain.handle(IPC.settingsSet, async (_event, next: Settings) => {
    const stored = await saveSettings(next);
    return { ...stored, ...applyHotkeys() };
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
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopWatching();
    destroyCapture();
    destroyTray();
  });
}
