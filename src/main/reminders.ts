import { Notification } from 'electron';
import fs from 'node:fs/promises';
import { dueLabel, dueTasks, reminderAt, reminderKey, type DueTask } from '../core/due';
import { pathsFor } from '../core/paths';
import type { ExternalChanges, Note } from '../shared/types';

/**
 * Reminders for dated tasks: while Notes runs (in the tray counts), a task
 * line with `@2026-09-10 14:30` shows a Windows notification at 14:30 that
 * day; one with a date alone, at nine that morning. Clicking it opens the
 * note. The main process keeps this, not the window, because the window
 * may be hidden or not yet loaded when the moment comes — the same reason
 * the tray settings live here.
 *
 * What has been shown is written to reminded.json, so restarting the app
 * does not show yesterday's reminders again; anything that came due while
 * the app was closed is shown once at the next launch, if it is still
 * undone and less than a day old. Older than that, it is on the due sheet
 * and in `notes due --overdue`, which is where it belongs.
 */

export interface RemindersDeps {
  userData: string;
  /** Whether reminders are on right now. */
  enabled(): boolean;
  /** Brings the window up at a note. */
  openNote(id: string): void;
}

export interface Reminders {
  /**
   * The notes as they stand now: recomputes what is due and when to wake.
   * Resolves once that has happened — the first call has a file to read
   * first — so a caller that must know it is done can wait for it. Callers
   * that need not simply drop the promise.
   */
  update(notes: Note[]): Promise<void>;
  /** A change from the folder watcher, applied to the last list seen. */
  applyChanges(changes: ExternalChanges): Promise<void>;
  /** Shows a notification now, as `notes due --notify` and the tests ask. */
  show(title: string, body: string, noteId?: string): boolean;
  stop(): void;
}

/** How long after its moment a reminder is still worth showing. */
const LATE_MS = 24 * 60 * 60 * 1000;
/** Node's setTimeout overflows past this; a longer wait is re-armed in steps. */
const MAX_WAIT_MS = 2 ** 31 - 1;
/** Keys older than this are dropped from reminded.json. */
const REMEMBER_MS = 60 * LATE_MS;
/**
 * A note edited this recently is still being typed. A task due earlier
 * today would otherwise fire the moment its date was typed, and again on
 * every keystroke of the words after it, since the words are in its key.
 */
export const QUIET_MS = 5000;

export function createReminders(deps: RemindersDeps): Reminders {
  const file = pathsFor(deps.userData).reminded;
  let notes: Note[] = [];
  let timer: NodeJS.Timeout | null = null;
  let shown = new Map<string, number>();
  let loaded: Promise<void> | null = null;

  async function load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, number>;
      const cutoff = Date.now() - REMEMBER_MS;
      shown = new Map(Object.entries(raw).filter(([, t]) => typeof t === 'number' && t > cutoff));
    } catch {
      shown = new Map();
    }
  }

  let persisting: Promise<void> = Promise.resolve();

  /** One write at a time: two at once would leave the file with the bytes of both. */
  function persist(): Promise<void> {
    const text = JSON.stringify(Object.fromEntries(shown));
    persisting = persisting.then(() => fs.writeFile(file, text, 'utf8')).catch((err) => console.error('[notes] could not write reminded.json', err));
    return persisting;
  }

  function show(title: string, body: string, noteId?: string): boolean {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title, body, silent: false });
    if (noteId) n.on('click', () => deps.openNote(noteId));
    n.show();
    return true;
  }

  function fire(task: DueTask): void {
    shown.set(reminderKey(task), Date.now());
    show(task.text || 'Task due', `${task.noteTitle} · ${dueLabel(task.due, task.hasTime)}`, task.noteId);
  }

  /** Shows what is due, then sleeps until the next moment something will be. */
  function tick(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!deps.enabled()) return;
    const now = Date.now();
    const edited = new Map(notes.map((n) => [n.id, n.updatedAt]));
    let next = Infinity;
    let fired = false;
    for (const task of dueTasks(notes)) {
      const at = reminderAt(task);
      const key = reminderKey(task);
      if (at <= now) {
        if (now - at > LATE_MS || shown.has(key)) continue;
        const quietUntil = (edited.get(task.noteId) ?? 0) + QUIET_MS;
        if (quietUntil > now) {
          next = Math.min(next, quietUntil);
          continue;
        }
        fire(task);
        fired = true;
        continue;
      }
      next = Math.min(next, at);
    }
    if (fired) void persist();
    if (next !== Infinity) timer = setTimeout(tick, Math.min(next - now + 250, MAX_WAIT_MS));
  }

  return {
    update(next) {
      notes = next;
      loaded ??= load();
      return loaded.then(tick);
    },
    applyChanges(changes) {
      let list = notes.filter((n) => !changes.removed.includes(n.id));
      for (const note of changes.upserts) list = list.some((n) => n.id === note.id) ? list.map((n) => (n.id === note.id ? note : n)) : [note, ...list];
      return this.update(list);
    },
    show,
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
