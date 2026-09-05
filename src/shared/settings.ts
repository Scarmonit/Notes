import { DEFAULT_JOURNAL_PATH, journalPathError } from '../core/journal';
import { cleanNotesFolder } from '../core/paths';
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
  /** Where the markdown files live, or null for the folder beside everything else. */
  notesFolder: string | null;
  /**
   * Where a dated note lives: a relative path format without `.md`, run
   * through the same date tokens a template uses, where a `/` makes a folder.
   * `Journal/YYYY/YYYY-MM-DD` is the default.
   *
   * Nothing marks a note as a journal entry. A date's note is whichever one
   * occupies the path this produces, so changing the format changes where
   * *new* dates are opened and moves nothing that is already written.
   */
  journalPath: string;
  /**
   * The note whose body a new journal entry starts from, by its id — an id
   * rather than a name, so renaming or moving the template does not quietly
   * break it. Null for an empty entry.
   */
  journalTemplateId: string | null;
}

/**
 * A search worth keeping. The name is what the sidebar shows and what
 * `notes list --view` answers to; the query is the same grammar the search
 * box and the command line already read, so a view is a saved question
 * rather than a new kind of thing.
 */
export interface SavedView extends ViewPresentation {
  name: string;
  query: string;
}

/** How a view is laid out: as the list it always was, or as a table or cards over the notes' properties. */
export type ViewLayout = 'list' | 'table' | 'cards';

/**
 * How a saved search is shown, beyond the query. Every field is optional and
 * absent means the plain list, so a settings file from before 0.28 reads the
 * same, and the command line — which reads only `query` — is untouched.
 * A column is `title`, `updated` or `prop:<key>`.
 */
export interface ViewPresentation {
  layout?: ViewLayout;
  columns?: string[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  groupBy?: string;
}

export const MAX_VIEWS = 24;

const LAYOUTS = new Set<ViewLayout>(['list', 'table', 'cards']);
const COLUMN = /^(?:title|updated|prop:[^\s]+)$/;

/** A presentation as it should be stored: known layouts, well-formed columns, nothing that means the default. */
export function cleanPresentation(raw: unknown): ViewPresentation {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const out: ViewPresentation = {};
  if (typeof v.layout === 'string' && LAYOUTS.has(v.layout as ViewLayout) && v.layout !== 'list') out.layout = v.layout as ViewLayout;
  if (Array.isArray(v.columns)) {
    const columns = Array.from(new Set(v.columns.filter((c): c is string => typeof c === 'string' && COLUMN.test(c))));
    if (columns.length > 0) out.columns = columns;
  }
  if (typeof v.sortBy === 'string' && COLUMN.test(v.sortBy)) {
    out.sortBy = v.sortBy;
    if (v.sortDir === 'desc') out.sortDir = 'desc';
  }
  if (typeof v.groupBy === 'string' && /^prop:[^\s]+$/.test(v.groupBy)) out.groupBy = v.groupBy;
  return out;
}

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
    out.push({ name, query, ...cleanPresentation(v) });
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

/**
 * A view added or replaced by name, keeping the order the others are in. A
 * presentation given here is the view's; none given keeps what the view of
 * that name already had, so saving a search again does not flatten its table.
 */
export function withView(views: SavedView[], name: string, query: string, presentation?: ViewPresentation): SavedView[] {
  const at = views.findIndex((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  const kept = presentation ?? (at >= 0 ? presentationOf(views[at]) : {});
  const clean: SavedView = { name: name.trim(), query: query.trim(), ...cleanPresentation(kept) };
  if (at < 0) return cleanViews([...views, clean]);
  return cleanViews(views.map((v, i) => (i === at ? clean : v)));
}

/** Just the presentation of a view, without its name and query. */
export function presentationOf(view: ViewPresentation): ViewPresentation {
  return cleanPresentation({ layout: view.layout, columns: view.columns, sortBy: view.sortBy, sortDir: view.sortDir, groupBy: view.groupBy });
}

export const DEFAULT_SETTINGS: Settings = {
  closeToTray: false,
  hotkey: 'ctrl+alt+n',
  captureHotkey: 'ctrl+alt+j',
  reminders: true,
  views: [],
  notesFolder: null,
  journalPath: DEFAULT_JOURNAL_PATH,
  journalTemplateId: null,
};

/** A journal path format from the file: anything unusable falls back to the default. */
function cleanJournalPath(value: unknown): string {
  const said = typeof value === 'string' ? value.trim() : '';
  if (!said) return DEFAULT_JOURNAL_PATH;
  return journalPathError(said) === null ? said : DEFAULT_JOURNAL_PATH;
}

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
    notesFolder: cleanNotesFolder(doc.notesFolder),
    journalPath: cleanJournalPath(doc.journalPath),
    journalTemplateId: typeof doc.journalTemplateId === 'string' && doc.journalTemplateId.trim() ? doc.journalTemplateId.trim() : null,
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
    notesFolder: cleanNotesFolder(next.notesFolder),
    journalPath: cleanJournalPath(next.journalPath),
    journalTemplateId: typeof next.journalTemplateId === 'string' && next.journalTemplateId.trim() ? next.journalTemplateId.trim() : null,
  };
}
