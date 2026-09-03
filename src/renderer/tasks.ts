/**
 * Task list lines — `- [ ] thing` and `- [x] thing` — as markdown defines
 * them. The preview renders them as checkboxes; ticking one has to write the
 * change back into the body, which is what these functions are for.
 *
 * Everything here works on the markdown text, never on the DOM, so the same
 * function serves the checkbox in the preview and the keyboard shortcut in
 * the editor.
 */

/** A task line: optional indent, a list bullet, then [ ] or [x]. */
const TASK = /^(\s*)([-*+])(\s+)\[([ xX])\](\s)/;
/** A plain list item, for turning into a task. */
const BULLET = /^(\s*)([-*+])(\s+)/;

export interface Task {
  /** Index of the line in the body. */
  line: number;
  done: boolean;
}

/** Every task line in a body, in order. The nth entry is the nth checkbox in the preview. */
export function tasksIn(body: string): Task[] {
  const out: Task[] = [];
  body.split('\n').forEach((text, line) => {
    const m = TASK.exec(text);
    if (m) out.push({ line, done: m[4].toLowerCase() === 'x' });
  });
  return out;
}

/** How many tasks a note holds and how many are done. */
export function taskProgress(body: string): { done: number; total: number } {
  const tasks = tasksIn(body);
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

function setDone(line: string, done: boolean): string {
  return line.replace(TASK, (_all, indent: string, bullet: string, gap: string, _box: string, tail: string) => `${indent}${bullet}${gap}[${done ? 'x' : ' '}]${tail}`);
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
