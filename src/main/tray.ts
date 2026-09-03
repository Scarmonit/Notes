import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { acceleratorOf } from '../shared/keys';

/**
 * The tray icon and the system-wide hotkey: the two ways the app can be
 * reached while its window is not in front. Both are optional conveniences,
 * so every failure here is logged and shrugged off rather than thrown.
 */

/** The app icon on disk. Packaged builds carry it as an extra resource. */
function iconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.ico'), path.join(process.resourcesPath, 'assets', 'icon.ico')]
    : [path.join(__dirname, '../../assets/icon.ico')];
  return candidates.find((p) => fs.existsSync(p)) ?? '';
}

let tray: Tray | null = null;

/** Brings the window back from the tray, wherever it was. */
export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** Show if hidden or behind, hide if it is already the window in front. */
export function toggleWindow(win: BrowserWindow): void {
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow(win);
}

export function createTray(win: BrowserWindow, onNewNote: () => void): void {
  if (tray) return;
  const file = iconPath();
  const image = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  if (image.isEmpty()) {
    console.error('[notes] no tray icon found; skipping the tray');
    return;
  }
  tray = new Tray(image);
  tray.setToolTip('Notes');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Notes', click: () => showWindow(win) },
      { label: 'New note', click: onNewNote },
      { type: 'separator' },
      { label: 'Quit Notes', click: () => app.quit() },
    ]),
  );
  // A single click is what people expect of a tray icon on Windows.
  tray.on('click', () => toggleWindow(win));
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

let registered: string | null = null;

/**
 * Registers the summon hotkey, replacing whatever was registered before.
 * Returns false when the chord is unusable or another app already owns it,
 * which the settings UI reports rather than failing silently.
 */
export function applyHotkey(chord: string | null, run: () => void): boolean {
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }
  if (!chord) return true;
  const accelerator = acceleratorOf(chord);
  if (!accelerator) return false;
  try {
    if (!globalShortcut.register(accelerator, run)) return false;
  } catch (err) {
    console.error('[notes] could not register the global shortcut', err);
    return false;
  }
  registered = accelerator;
  return true;
}
