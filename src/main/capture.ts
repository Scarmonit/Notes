import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/channels';

/**
 * The quick-note box: a small window on the global hotkey that takes one
 * thought and goes away. It is not the app — it has no list and no editor —
 * so it is cheap to keep around hidden and instant to show, which is what
 * "write this down before I forget it" needs.
 */

const WIDTH = 540;
const HEIGHT = 172;
const BG = '#1a2130';

let win: BrowserWindow | null = null;

function create(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: BG,
    title: 'Quick note',
    webPreferences: {
      preload: path.join(__dirname, 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  w.setMenuBarVisibility(false);
  // Like a launcher: clicking anywhere else is the same as pressing Esc.
  w.on('blur', () => w.hide());
  w.on('closed', () => {
    win = null;
  });
  w.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') w.webContents.toggleDevTools();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void w.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/capture.html`);
  } else {
    void w.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/capture.html`));
  }
  return w;
}

/** Shows the box on the screen the pointer is on, a little above centre, ready to type into. */
export function showCapture(): void {
  if (!win) win = create();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setPosition(Math.round(area.x + (area.width - WIDTH) / 2), Math.round(area.y + area.height * 0.26));
  win.show();
  win.focus();
  win.webContents.send(IPC.captureShown);
}

export function hideCapture(): void {
  if (win?.isVisible()) win.hide();
}

export function toggleCapture(): void {
  if (win?.isVisible() && win.isFocused()) hideCapture();
  else showCapture();
}

export function destroyCapture(): void {
  win?.destroy();
  win = null;
}
