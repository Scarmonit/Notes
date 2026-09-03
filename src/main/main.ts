import { app, BrowserWindow, globalShortcut, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/channels';
import type { ExportRequest, NotesFile } from '../shared/types';
import type { Settings } from '../shared/settings';
import { installAssetProtocol, pickAttachments, registerAssetScheme, saveAttachment, sweepOrphans } from './attachments';
import { installContextMenu } from './context-menu';
import { exportNote } from './export';
import { pickImports } from './import';
import { loadNotes, saveNotes } from './notes-store';
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAssetScheme();
  // No application menu: its default accelerators (Ctrl+Shift+I, Ctrl+R...)
  // would shadow the app's own shortcuts. F12 still opens DevTools.
  Menu.setApplicationMenu(null);

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) showWindow(win);
  });

  ipcMain.handle(IPC.notesLoad, () => loadNotes());
  ipcMain.handle(IPC.notesSave, async (_event, file: NotesFile) => {
    await saveNotes(file);
    void sweepOrphans(file).catch((err) => console.error('[notes] attachment sweep failed', err));
  });
  ipcMain.handle(IPC.attach, (_event, bytes: Uint8Array, name: string) => saveAttachment(bytes, name));
  ipcMain.handle(IPC.pickAttachments, (event) => pickAttachments(windowFor(event)));
  ipcMain.handle(IPC.pickImports, (event) => pickImports(windowFor(event)));
  ipcMain.handle(IPC.exportNote, (event, request: ExportRequest) => exportNote(windowFor(event), request));
  ipcMain.handle(IPC.settingsGet, () => settings());
  ipcMain.handle(IPC.settingsSet, async (event, next: Settings) => {
    const stored = await saveSettings(next);
    const win = windowFor(event);
    const ok = applyHotkey(stored.hotkey, () => toggleWindow(win));
    return { ...stored, hotkeyFailed: stored.hotkey !== null && !ok };
  });

  void app.whenReady().then(async () => {
    installAssetProtocol();
    await loadSettings();
    const win = createWindow();
    createTray(win, () => {
      showWindow(win);
      win.webContents.send(IPC.newNote);
    });
    applyHotkey(settings().hotkey, () => toggleWindow(win));
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    destroyTray();
  });
}
