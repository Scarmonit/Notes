import { tagsOf, titleOf } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * Templates are ordinary notes tagged `#template`, the way Obsidian keeps
 * them in an ordinary folder: nothing new to learn, and a template is
 * written and edited like anything else. Making a note from one, or
 * inserting one into a note, expands the placeholders below and drops the
 * `#template` tag, so what comes out is a note and not another template.
 *
 * Placeholders: `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, and
 * `{{date:FORMAT}}` / `{{time:FORMAT}}` with the tokens of `formatDate`.
 */

export const TEMPLATE_TAG = 'template';

export const isTemplate = (note: Pick<Note, 'body'>): boolean => tagsOf(note.body).includes(TEMPLATE_TAG);

/** The template notes, by title. */
export function templatesOf(notes: Note[]): Note[] {
  return notes.filter(isTemplate).sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }));
}

/** The template a name means: its exact title, else the one title starting with it (case-folded). */
export function templateNamed(notes: Note[], name: string): Note | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const all = templatesOf(notes);
  return all.find((n) => titleOf(n).toLowerCase() === want) ?? all.find((n) => titleOf(n).toLowerCase().startsWith(want)) ?? null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/**
 * A date in a small format language, the familiar subset of moment's:
 * YYYY YY MMMM MMM MM M DDDD DDD DD D HH H hh h mm ss A a. Anything in
 * [square brackets] is kept as it is written.
 */
export function formatDate(d: Date, format: string): string {
  const h12 = d.getHours() % 12 || 12;
  const token = (t: string): string => {
    switch (t) {
      case 'YYYY':
        return String(d.getFullYear());
      case 'YY':
        return pad(d.getFullYear() % 100);
      case 'MMMM':
        return MONTHS[d.getMonth()];
      case 'MMM':
        return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'M':
        return String(d.getMonth() + 1);
      case 'DDDD':
        return DAYS[d.getDay()];
      case 'DDD':
        return DAYS[d.getDay()].slice(0, 3);
      case 'DD':
        return pad(d.getDate());
      case 'D':
        return String(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'H':
        return String(d.getHours());
      case 'hh':
        return pad(h12);
      case 'h':
        return String(h12);
      case 'mm':
        return pad(d.getMinutes());
      case 'ss':
        return pad(d.getSeconds());
      case 'A':
        return d.getHours() < 12 ? 'AM' : 'PM';
      case 'a':
        return d.getHours() < 12 ? 'am' : 'pm';
      default:
        return t;
    }
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|HH|H|hh|h|mm|ss|A|a/g, (m, literal: string | undefined) => (literal !== undefined ? literal : token(m)));
}

export const DATE_FORMAT = 'YYYY-MM-DD';
export const TIME_FORMAT = 'HH:mm';

export interface ExpandOptions {
  /** What `{{title}}` becomes. */
  title?: string;
  now?: Date;
}

const PLACEHOLDER = /\{\{\s*(title|date|time|datetime)(?::([^}]*))?\s*\}\}/gi;

/** The text with its placeholders filled in. Unknown placeholders are left alone. */
export function expandPlaceholders(text: string, options: ExpandOptions = {}): string {
  const now = options.now ?? new Date();
  const title = options.title ?? '';
  return text.replace(PLACEHOLDER, (_m, name: string, format: string | undefined) => {
    switch (name.toLowerCase()) {
      case 'title':
        return title;
      case 'date':
        return formatDate(now, format?.trim() || DATE_FORMAT);
      case 'time':
        return formatDate(now, format?.trim() || TIME_FORMAT);
      case 'datetime':
        return formatDate(now, format?.trim() || `${DATE_FORMAT} ${TIME_FORMAT}`);
      default:
        return _m;
    }
  });
}

/** Takes the `#template` tag out, and the line it sat on if nothing else was there. */
export function withoutTemplateTag(body: string): string {
  const after = '(?![\\p{L}\\p{N}_/-])';
  return body
    // The tag and the space before it; or, at the start of a line, the tag and the space after it.
    .replace(new RegExp(`[ \\t]+#${TEMPLATE_TAG}${after}`, 'giu'), '')
    .replace(new RegExp(`^#${TEMPLATE_TAG}${after}[ \\t]*`, 'gimu'), '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

/** A template's body as it should land in a note: placeholders filled, the tag gone. */
export function expandTemplate(template: Pick<Note, 'body'>, options: ExpandOptions = {}): string {
  return expandPlaceholders(withoutTemplateTag(template.body), options);
}

/** Whether a body uses any placeholder, for deciding whether a title is needed first. */
export const usesTitle = (body: string): boolean => /\{\{\s*title\s*\}\}/i.test(body);
