import { checkPlan, invertPlan, type NoteState, type Plan } from '../core/refactor';
import type { Note } from '../shared/types';

/**
 * Applying a Plan in the window, and taking it back as one step.
 *
 * A Plan touches several notes; each of them has an undo log of its own.
 * Applying one pushes a *group* entry onto every touched note's log, all
 * carrying the same group id. Undo on any of those notes then reverts the
 * whole Plan — every note at once, after checking none of them has moved
 * on — and moves the group entries to the redo side, so redo is the Plan
 * again. The window supplies the mutations through a host; nothing here
 * touches the DOM.
 */

/** One step in a note's undo log. Plain edits have text and caret; a group step points at a Plan. */
export interface EditStep {
  text: string;
  caret: number;
  group?: string;
}

export interface EditLog {
  undo: EditStep[];
  redo: EditStep[];
  lastAt: number;
  lastKind: string;
}

export interface RefactorHost {
  notes(): Note[];
  /** Replaces a note's text and title as one mutation, redrawing it if it is on screen. */
  update(id: string, state: NoteState): void;
  /** Moves a note to the trash. */
  trash(id: string): void;
  /** Brings a note back from the trash; null when it is gone for good. */
  restore(id: string): Promise<Note | null>;
  /** The undo log of a note, made if it has none yet. */
  log(id: string): EditLog;
  /** The caret in a note as it stands, or 0 when it is not on screen. */
  caret(id: string): number;
}

export type ApplyResult = { ok: true; plan: Plan } | { ok: false; code: 'stale' | 'gone'; message: string };

interface Group {
  /** The Plan as applied; undo runs its inverse, redo runs it again. */
  forward: Plan;
  backward: Plan;
}

const groups = new Map<string, Group>();
let nextGroup = 1;

const touchedIds = (plan: Plan): string[] => [...new Set([...plan.writes.map((w) => w.id), ...plan.trash.map((t) => t.id), ...plan.restore.map((r) => r.id)])];

/** Runs a Plan's mutations through the host: restores, writes, then trash. */
async function run(plan: Plan, host: RefactorHost): Promise<ApplyResult> {
  const check = checkPlan(plan, host.notes());
  if (!check.ok) return { ok: false, code: 'stale', message: check.message };
  for (const r of plan.restore) {
    const back = await host.restore(r.id);
    if (!back) return { ok: false, code: 'gone', message: 'The note to put back is no longer in the trash' };
  }
  for (const w of plan.writes) host.update(w.id, w.after);
  for (const t of plan.trash) host.trash(t.id);
  return { ok: true, plan };
}

/** Applies a Plan and registers it as one undo step across every note it touches. */
export async function applyPlan(plan: Plan, host: RefactorHost): Promise<ApplyResult> {
  // The state before, taken from the live notes so the group step holds the text as it was.
  const before = new Map(touchedIds(plan).map((id) => [id, { text: host.notes().find((n) => n.id === id)?.body ?? '', caret: host.caret(id) }]));
  const result = await run(plan, host);
  if (!result.ok) return result;
  const id = `g${nextGroup++}`;
  groups.set(id, { forward: plan, backward: invertPlan(plan) });
  for (const noteId of touchedIds(plan)) {
    const log = host.log(noteId);
    const was = before.get(noteId) ?? { text: '', caret: 0 };
    log.undo.push({ text: was.text, caret: was.caret, group: id });
    log.redo = [];
    log.lastKind = '';
  }
  return result;
}

/** Whether a step is one of a group's, so undo and redo know to take the whole group. */
export const groupOf = (step: EditStep | undefined): string | null => step?.group ?? null;

function moveSteps(plan: Plan, group: string, host: RefactorHost, from: 'undo' | 'redo', to: 'undo' | 'redo'): void {
  for (const noteId of touchedIds(plan)) {
    const log = host.log(noteId);
    const at = log[from].findIndex((s) => s.group === group);
    const step = at >= 0 ? log[from].splice(at, 1)[0] : { text: '', caret: 0, group };
    log[to].push({ text: host.notes().find((n) => n.id === noteId)?.body ?? step.text, caret: 0, group });
    log.lastKind = '';
  }
}

/** Takes a whole Plan back, on every note it touched, if none has changed since. */
export async function undoGroup(group: string, host: RefactorHost): Promise<ApplyResult> {
  const g = groups.get(group);
  if (!g) return { ok: false, code: 'gone', message: 'That step is no longer known' };
  const result = await run(g.backward, host);
  if (!result.ok) return result;
  moveSteps(g.forward, group, host, 'undo', 'redo');
  return result;
}

/** Runs a Plan again after it was undone. */
export async function redoGroup(group: string, host: RefactorHost): Promise<ApplyResult> {
  const g = groups.get(group);
  if (!g) return { ok: false, code: 'gone', message: 'That step is no longer known' };
  const result = await run(g.forward, host);
  if (!result.ok) return result;
  moveSteps(g.forward, group, host, 'redo', 'undo');
  return result;
}

/** For tests: no groups remembered. */
export function resetGroups(): void {
  groups.clear();
}
