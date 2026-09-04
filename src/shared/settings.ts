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
  /** Windows notifications when a task's `@date` comes due, while Notes runs. */
  reminders: boolean;
  /** Named searches, kept in the sidebar and answerable from the command line. */
  views: SavedView[];
}

/**
 * A search worth keeping. The name is what the sidebar shows and what
 * `notes list --view` answers to; the query is the same grammar the search
 * box and the command line already read, so a view is a saved question
 * rather than a new kind of thing.
 */
export interface SavedView {
  name: string;
  query: string;
}

export const MAX_VIEWS = 24;

/** Views as they should be stored: named, non-empty, no two by the same name. */
export function cleanViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const query = typeof v.query === 'string' ? v.query.trim() : '';
    if (!name || !query || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, query });
    if (out.length >= MAX_VIEWS) break;
  }
  return out;
}

/** The view a name asks for: exactly, else the only one it begins. */
export function viewNamed(views: SavedView[], name: string): SavedView | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = views.find((v) => v.name.toLowerCase() === want);
  if (exact) return exact;
  const started = views.filter((v) => v.name.toLowerCase().startsWith(want));
  return started.length === 1 ? started[0] : null;
}

/** A view added or replaced by name, keeping the order the others are in. */
export function withView(views: SavedView[], name: string, query: string): SavedView[] {
  const clean = { name: name.trim(), query: query.trim() };
  const at = views.findIndex((v) => v.name.toLowerCase() === clean.name.toLowerCase());
  if (at < 0) return cleanViews([...views, clean]);
  return cleanViews(views.map((v, i) => (i === at ? clean : v)));
}

export const DEFAULT_SETTINGS: Settings = { closeToTray: false, hotkey: 'ctrl+alt+n', captureHotkey: 'ctrl+alt+j', reminders: true, views: [] };

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
    // Missing means the default (on); only an explicit false turns them off.
    reminders: doc.reminders !== false,
    views: cleanViews(doc.views),
  };
}

/** The settings as they should be stored: nothing but the known fields, each of the right shape. */
export function cleanSettings(next: Settings): Settings {
  return {
    closeToTray: next.closeToTray === true,
    hotkey: usableHotkey(next.hotkey),
    captureHotkey: usableHotkey(next.captureHotkey),
    reminders: next.reminders !== false,
    views: cleanViews(next.views),
  };
}
