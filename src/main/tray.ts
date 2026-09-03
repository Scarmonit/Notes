import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { acceleratorOf } from '../shared/keys';

/**
 * The tray icon and the system-wide hotkeys: the ways the app can be reached
 * while its window is not in front. All are optional conveniences, so every
 * failure here is logged and shrugged off rather than thrown.
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

export interface TrayActions {
  newNote: () => void;
  quickNote: () => void;
}

export function createTray(win: BrowserWindow, actions: TrayActions): void {
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
      { label: 'New note', click: actions.newNote },
      { label: 'Quick note', click: actions.quickNote },
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

/** Which of the app's system-wide chords is being set. */
export type HotkeySlot = 'summon' | 'capture';

const registered = new Map<HotkeySlot, string>();

/**
 * Lets go of both chords. Done before the two are applied afresh, so a chord
 * moving from one slot to the other is not refused for still being held by
 * the slot it is leaving.
 */
export function releaseHotkeys(): void {
  for (const accelerator of registered.values()) globalShortcut.unregister(accelerator);
  registered.clear();
}

/**
 * Registers one of the system-wide chords, replacing whatever that slot held
 * before. Returns false when the chord is unusable or another app already
 * owns it, which the settings UI reports rather than failing silently.
 */
export function applyHotkey(slot: HotkeySlot, chord: string | null, run: () => void): boolean {
  const previous = registered.get(slot);
  if (previous) {
    globalShortcut.unregister(previous);
    registered.delete(slot);
  }
  if (!chord) return true;
  const accelerator = acceleratorOf(chord);
  if (!accelerator) return false;
  // The two slots must not fight over one chord; the later one loses.
  for (const [other, acc] of registered) {
    if (other !== slot && acc === accelerator) return false;
  }
  try {
    if (!globalShortcut.register(accelerator, run)) return false;
  } catch (err) {
    console.error('[notes] could not register the global shortcut', err);
    return false;
  }
  registered.set(slot, accelerator);
  return true;
}
