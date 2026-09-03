import { acceleratorOf } from './keys';

/**
 * Settings the main process acts on, so they live in their own file next to
 * notes.json rather than in the renderer's localStorage: the window may be
 * closing, hidden or not yet loaded when they are needed.
 */
export interface Settings {
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean;
  /** A system-wide chord that summons the window, or null for none. */
  hotkey: string | null;
}

export const DEFAULT_SETTINGS: Settings = { closeToTray: false, hotkey: 'ctrl+alt+n' };

/** A chord Electron can register system-wide, or null. */
export function usableHotkey(chord: string | null | undefined): string | null {
  return chord && acceleratorOf(chord) ? chord : null;
}

/** Reads settings.json, filling in anything missing or malformed. */
export function parseSettings(text: string): Settings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const doc = raw as Record<string, unknown>;
  return {
    closeToTray: doc.closeToTray === true,
    // An explicit null means "no hotkey"; anything unusable falls back to the default.
    hotkey: doc.hotkey === null ? null : usableHotkey(typeof doc.hotkey === 'string' ? doc.hotkey : null) ?? DEFAULT_SETTINGS.hotkey,
  };
}
