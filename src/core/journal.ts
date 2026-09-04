import { formatDate } from './templates';
import { addDays } from './due';
import { folderKey, ROOT_FOLDER } from '../shared/folders';
import { titleOf } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * Today's note: where a dated entry lives, and which date a person meant.
 *
 * The whole feature is one setting. `journal.pathFormat` is a relative path
 * without `.md`, run through the same `formatDate` a template uses, and a `/`
 * in what comes out makes a folder. `Journal/YYYY/YYYY-MM-DD` gives
 * `Journal/2026/2026-09-06.md`: one year browsable as a folder, five years
 * that are not one enormous list.
 *
 * A journal note is not marked. Nothing is written into its front matter
 * saying what it is — **it is the note occupying the path for that date**, and
 * that is the whole of its identity. Change the format and old entries do not
 * move or stop being notes; they were only ever notes.
 */

/** Where dated notes go, by default. */
export const DEFAULT_JOURNAL_PATH = 'Journal/YYYY/YYYY-MM-DD';

/** A date, with no time on it: what a journal entry is for. */
export interface JournalDate {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/** The local calendar date of a moment. */
export const dateOf = (at: Date): JournalDate => ({ year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() });

/** A journal date as `2026-09-06`, which is how it is reported and typed. */
export const isoDate = (d: JournalDate): string => `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * The instant a journal date's template is expanded against: local noon.
 *
 * Noon rather than midnight, because a date formatted from midnight can slip
 * to the day before on a clock change, and a back-filled entry stamped with
 * the moment it was typed would say the wrong day entirely.
 */
export const momentOf = (d: JournalDate): Date => new Date(d.year, d.month - 1, d.day, 12, 0, 0, 0);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * The date a person named.
 *
 * Calendar dates only: `today`, `yesterday`, `tomorrow`, `+3d`, `-2w`, a
 * weekday, or an ISO date. A time on its own is not a date and is refused —
 * this resolves which day, not which moment, and `16:00` would silently mean
 * today in a command whose whole job is to be precise about the day.
 */
export function parseJournalDate(text: string, now: Date = new Date()): JournalDate | null {
  const said = text.trim().toLowerCase();
  if (!said || said === 'today') return dateOf(now);
  if (said === 'yesterday') return dateOf(new Date(addDays(now.getTime(), -1)));
  if (said === 'tomorrow') return dateOf(new Date(addDays(now.getTime(), 1)));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(said);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const made = new Date(year, month - 1, day);
    // A day that rolled over — 2026-02-30 — was not a date anybody has.
    if (made.getFullYear() !== year || made.getMonth() !== month - 1 || made.getDate() !== day) return null;
    return { year, month, day };
  }
  const offset = /^([-+])(\d{1,4})\s*([dwmy])?$/.exec(said);
  if (offset) {
    const n = Number(offset[2]) * (offset[1] === '-' ? -1 : 1);
    const unit = offset[3] ?? 'd';
    if (unit === 'd') return dateOf(new Date(addDays(now.getTime(), n)));
    if (unit === 'w') return dateOf(new Date(addDays(now.getTime(), n * 7)));
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (unit === 'm') at.setMonth(at.getMonth() + n);
    else at.setFullYear(at.getFullYear() + n);
    return dateOf(at);
  }
  const weekday = WEEKDAYS.findIndex((name) => name === said || name.slice(0, 3) === said);
  if (weekday >= 0) {
    // The next one there is, today included: "friday" on a Friday is today.
    const ahead = (weekday - now.getDay() + 7) % 7;
    return dateOf(new Date(addDays(now.getTime(), ahead)));
  }
  return null;
}

/** The tokens `formatDate` knows, longest first, as one alternation. */
const TOKENS = 'YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|HH|H|hh|h|mm|ss|A|a';

/** A run of letters that is made of nothing but date tokens. */
const ALL_TOKENS = new RegExp(`^(?:${TOKENS})+$`);

/**
 * A path format filled in with a date.
 *
 * `formatDate`'s language is meant for a line of text, where a stray `a` is
 * plainly a token. In a path it is not: `Journal` is a folder somebody named,
 * and turning it into `Journpml` because `a` means am/pm would be absurd. So
 * the rule here is one step more forgiving — **a run of letters is literal
 * unless the whole run is date tokens.** `YYYY` and `MMMM` are formatted,
 * `Journal` and `Daily` are the words they are, and `[brackets]` still force
 * a literal for a folder that really is called `MMM`.
 */
export function formatJournalPath(at: Date, format: string): string {
  return format.replace(/\[([^\]]*)\]|[A-Za-z]+/g, (whole, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    return ALL_TOKENS.test(whole) ? formatDate(at, whole) : whole;
  });
}

/** What went wrong with a path format, or null when it is usable. */
export function journalPathError(format: string, at: Date = new Date()): string | null {
  const path = formatJournalPath(at, format);
  if (!path.trim()) return 'The journal path is empty';
  const parts = path.split('/');
  if (parts.some((p) => !p.trim())) return 'The journal path has an empty folder in it';
  if (parts.some((p) => p === '.' || p === '..')) return 'The journal path cannot step outside the notes folder';
  if (/[<>:"\\|?*]/.test(path) || [...path].some((c) => c.charCodeAt(0) < 32)) return 'The journal path has characters a filename cannot hold';
  return null;
}

/** Where a date's note lives: its folder and the title it is filed under. */
export interface JournalPlace {
  /** The folder, `/`-separated, empty for the root. */
  folder: string;
  /** The note's title, which is also the leaf of its filename. */
  title: string;
  /** The whole thing, as it would read in a link or a path. */
  path: string;
}

/** The place a date's note occupies under a path format. */
export function journalPlace(date: JournalDate, format: string = DEFAULT_JOURNAL_PATH): JournalPlace {
  const path = formatJournalPath(momentOf(date), format).replace(/\\/g, '/').replace(/\.md$/i, '');
  const at = path.lastIndexOf('/');
  const folder = at < 0 ? '' : path.slice(0, at);
  const title = at < 0 ? path : path.slice(at + 1);
  return { folder, title, path };
}

/**
 * The note occupying a date's place, if one is there.
 *
 * Occupancy is the whole of a journal entry's identity: the note at that
 * path is that date's note, whatever it is called inside and whoever made
 * it. Its file name is asked first, because that is what "occupies the path"
 * means; a note whose title matches but whose file was numbered aside is the
 * next-best answer.
 */
export function journalNoteAt(notes: readonly Note[], place: JournalPlace): Note | null {
  const here = notes.filter((n) => folderKey(n.folder ?? ROOT_FOLDER) === folderKey(place.folder));
  const want = `${place.title.toLowerCase()}.md`;
  return here.find((n) => (n.file ?? '').toLowerCase() === want) ?? here.find((n) => titleOf(n).toLowerCase() === place.title.toLowerCase()) ?? null;
}
