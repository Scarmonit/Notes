import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/channels';
import type { NotesFile } from '../shared/types';
import { loadNotes, saveNotes } from './notes-store';

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  ipcMain.handle(IPC.notesLoad, () => loadNotes());
  ipcMain.handle(IPC.notesSave, (_event, file: NotesFile) => saveNotes(file));

  void app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
