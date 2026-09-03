import { acceleratorOf } from './keys';

/**
 * Settings the main process acts on, so they live in their own file next to
 * the notes rather than in the renderer's localStorage: the window may be
 * closing, hidden or not yet loaded when they are needed.
 */
export interface Settings {
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean;
  /** A system-wide chord that summons the window, or null for none. */
  hotkey: string | null;
  /** A system-wide chord that opens the quick-note box, or null for none. */
  captureHotkey: string | null;
}

export const DEFAULT_SETTINGS: Settings = { closeToTray: false, hotkey: 'ctrl+alt+n', captureHotkey: 'ctrl+alt+j' };

/** A chord Electron can register system-wide, or null. */
export function usableHotkey(chord: string | null | undefined): string | null {
  return chord && acceleratorOf(chord) ? chord : null;
}

/** A chord from the file: an explicit null means "none"; anything unusable falls back to the default. */
function chordField(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return usableHotkey(typeof value === 'string' ? value : null) ?? fallback;
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
    hotkey: chordField(doc.hotkey, DEFAULT_SETTINGS.hotkey),
    captureHotkey: chordField(doc.captureHotkey, DEFAULT_SETTINGS.captureHotkey),
  };
}

/** The settings as they should be stored: nothing but the known fields, each of the right shape. */
export function cleanSettings(next: Settings): Settings {
  return {
    closeToTray: next.closeToTray === true,
    hotkey: usableHotkey(next.hotkey),
    captureHotkey: usableHotkey(next.captureHotkey),
  };
}
