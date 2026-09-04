import { isFenceLine } from './fences';

/**
 * Task list lines — `- [ ] thing` and `- [x] thing` — as markdown defines
 * them. The preview renders them as checkboxes; ticking one has to write the
 * change back into the body, which is what these functions are for.
 *
 * A task can carry a date: `- [ ] pay rent @2026-09-10`, or with a time,
 * `@2026-09-10 14:30`. The date is part of the line's text, so it survives
 * every editor and every sync tool; `taskDue` reads it and `setTaskDue`
 * writes it.
 *
 * Everything here works on the markdown text, never on the DOM, so the same
 * function serves the checkbox in the preview and the keyboard shortcut in
 * the editor.
 */

/**
 * A task line as the preview draws one: optional quote marks and indent, a
 * bullet or a number, then [ ] or [x] and a space. The nth line here must be
 * the nth checkbox on the page, so the forms are exactly those marked
 * turns into a checkbox.
 */
const TASK = /^((?:[ \t]*>)*[ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)\[([ xX])\] /;
/** A plain list item, for turning into a task. */
const BULLET = /^((?:[ \t]*>)*[ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/;
/** `@YYYY-MM-DD`, optionally `@YYYY-MM-DD HH:mm`, standing on its own in the line. */
const DUE = /(^|\s)@(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?(?=\s|$)/;

export interface Task {
  /** Index of the line in the body. */
  line: number;
  done: boolean;
  /** When the line carries an @date: the moment it is due, local time. */
  due?: number;
  /** Whether that @date also named a time of day. */
  hasTime?: boolean;
}

export interface Due {
  at: number;
  hasTime: boolean;
  /** The `@…` token as written, for replacing it. */
  token: string;
}

/** The @date on a line, or null. A date that is not a real day (2026-13-45) is no date. */
export function taskDue(line: string): Due | null {
  const m = DUE.exec(line);
  if (!m) return null;
  const [year, month, day] = [Number(m[2]), Number(m[3]), Number(m[4])];
  const hasTime = m[5] !== undefined;
  const hours = hasTime ? Number(m[5]) : 0;
  const minutes = hasTime ? Number(m[6]) : 0;
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day || hours > 23 || minutes > 59) return null;
  return { at: d.getTime(), hasTime, token: m[0].slice(m[1].length) };
}

/** Every task line in a body, in order. The nth entry is the nth checkbox in the preview; a task inside a code fence is code. */
export function tasksIn(body: string): Task[] {
  const out: Task[] = [];
  let inFence = false;
  // An indented code block (four spaces after a blank line, outside a list)
  // draws no checkbox either, however task-like its lines look.
  let inCode = false;
  let prevBlank = true;
  let inList = false;
  body.split('\n').forEach((text, line) => {
    if (isFenceLine(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const blank = !text.trim();
    const indent = (/^[ \t]*/.exec(text) as RegExpExecArray)[0].replace(/\t/g, '    ').length;
    if (inCode) {
      if (blank || indent >= 4) return;
      inCode = false;
    } else if (!blank && indent >= 4 && prevBlank && !inList) {
      inCode = true;
      return;
    }
    if (!blank) inList = BULLET.test(text) || (inList && (indent >= 2 || !prevBlank));
    prevBlank = blank;
    const m = TASK.exec(text);
    if (!m) return;
    const due = taskDue(text);
    out.push(due ? { line, done: m[4].toLowerCase() === 'x', due: due.at, hasTime: due.hasTime } : { line, done: m[4].toLowerCase() === 'x' });
  });
  return out;
}

/** How many tasks a note holds and how many are done. */
export function taskProgress(body: string): { done: number; total: number } {
  const tasks = tasksIn(body);
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

function setDone(line: string, done: boolean): string {
  return line.replace(TASK, (_all, indent: string, bullet: string, gap: string) => `${indent}${bullet}${gap}[${done ? 'x' : ' '}] `);
}

/** Ticks or unticks the task on one line. Lines that are not tasks are left alone. */
export function toggleTaskLine(body: string, line: number): string {
  const lines = body.split('\n');
  const text = lines[line];
  const m = text === undefined ? null : TASK.exec(text);
  if (!m) return body;
  lines[line] = setDone(text, m[4].toLowerCase() !== 'x');
  return lines.join('\n');
}

/** Ticks or unticks the nth task of the note, counting from the top. */
export function toggleTaskAt(body: string, index: number): string {
  const task = tasksIn(body)[index];
  return task ? toggleTaskLine(body, task.line) : body;
}

/**
 * Cycles one line between the three states a checklist line can be in:
 * ordinary text becomes an unticked task, an unticked task ticks, and a ticked
 * task goes back to ordinary text. Writing a list is then one repeated
 * keystroke rather than three different edits.
 */
export function cycleTaskLine(body: string, line: number): string {
  const lines = body.split('\n');
  const text = lines[line];
  if (text === undefined) return body;
  const task = TASK.exec(text);
  if (task) {
    lines[line] = task[4].toLowerCase() === 'x' ? text.replace(TASK, '$1$2$3') : setDone(text, true);
  } else {
    const bullet = BULLET.exec(text);
    lines[line] = bullet ? text.replace(BULLET, '$1$2$3[ ] ') : text.replace(/^(\s*)/, '$1- [ ] ');
  }
  return lines.join('\n');
}

const two = (n: number): string => String(n).padStart(2, '0');

/** The `@…` token for a moment: `@2026-09-10`, or `@2026-09-10 14:30` when a time matters. */
export function dueToken(at: number, withTime: boolean): string {
  const d = new Date(at);
  const day = `@${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return withTime ? `${day} ${two(d.getHours())}:${two(d.getMinutes())}` : day;
}

/**
 * Puts an @date on a line (replacing one already there), or takes it off
 * with null. A line that is not a task is made one first, so "this is due
 * Friday" is one edit.
 */
export function setTaskDue(body: string, line: number, due: { at: number; withTime: boolean } | null): string {
  const lines = body.split('\n');
  let text = lines[line];
  if (text === undefined) return body;
  if (!TASK.test(text)) {
    const bullet = BULLET.exec(text);
    text = bullet ? text.replace(BULLET, '$1$2$3[ ] ') : text.replace(/^(\s*)/, '$1- [ ] ');
  }
  const had = taskDue(text);
  // The token goes, and with it the one space that separated it from what
  // followed. Only the words are tidied: the indent in front is what nests
  // the task under its parent.
  if (had) {
    const head = TASK.exec(text)?.[0] ?? '';
    const words = text.slice(head.length).replace(DUE, '').replace(/[ \t]{2,}/g, ' ').trim();
    text = head + words;
  }
  if (due) text = `${text.trimEnd()} ${dueToken(due.at, due.withTime)}`;
  lines[line] = text;
  return lines.join('\n');
}
