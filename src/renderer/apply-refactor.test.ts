import { beforeEach, describe, expect, it } from 'vitest';
import { planMerge, planRefile, planRename, type Plan } from '../core/refactor';
import type { Note } from '../shared/types';
import { applyPlan, groupOf, redoGroup, resetGroups, undoGroup, type EditLog, type RefactorHost } from './apply-refactor';

const note = (id: string, body: string, title?: string): Note => (title === undefined ? { id, body, createdAt: 1, updatedAt: 1 } : { id, body, title, createdAt: 1, updatedAt: 1 });

/** A host over plain arrays: the notes, a trash, and one edit log per note. */
function fakeHost(initial: Note[]) {
  let notes = initial.map((n) => ({ ...n }));
  const trash: Note[] = [];
  const logs = new Map<string, EditLog>();
  const host: RefactorHost = {
    notes: () => notes,
    update: (id, state) => {
      notes = notes.map((n) => {
        if (n.id !== id) return n;
        const { title: _old, ...rest } = n;
        return state.title !== undefined ? { ...rest, title: state.title, body: state.body, updatedAt: 2 } : { ...rest, body: state.body, updatedAt: 2 };
      });
    },
    trash: (id) => {
      const gone = notes.find((n) => n.id === id);
      if (gone) trash.push(gone);
      notes = notes.filter((n) => n.id !== id);
    },
    restore: async (id) => {
      const i = trash.findIndex((n) => n.id === id);
      if (i < 0) return null;
      const [back] = trash.splice(i, 1);
      notes = [back, ...notes];
      return back;
    },
    log: (id) => {
      let log = logs.get(id);
      if (!log) {
        log = { undo: [], redo: [], lastAt: 0, lastKind: '' };
        logs.set(id, log);
      }
      return log;
    },
    caret: (id) => (id === 'in' ? 7 : 0),
  };
  return { host, get notes() { return notes; }, trash, logs };
}

function must(r: ReturnType<typeof planRefile>): Plan {
  if (!r.ok) throw new Error(r.code);
  return r.plan;
}

beforeEach(resetGroups);

describe('applyPlan', () => {
  it('applies every write and registers one group step on each touched note', async () => {
    const h = fakeHost([note('in', 'a\n\nmove me', 'Inbox'), note('pr', '# P')]);
    const plan = must(planRefile(h.notes, { from: 'in', first: 2, last: 2, to: 'pr', target: { line: 0 } }));
    const r = await applyPlan(plan, h.host);
    expect(r.ok).toBe(true);
    expect(h.notes.map((n) => n.body)).toEqual(['a', '# P\n\nmove me']);
    const inLog = h.host.log('in');
    const prLog = h.host.log('pr');
    expect(inLog.undo).toHaveLength(1);
    expect(inLog.undo[0]).toEqual({ text: 'a\n\nmove me', caret: 7, group: inLog.undo[0].group });
    expect(prLog.undo[0].group).toBe(inLog.undo[0].group);
    expect(groupOf(inLog.undo[0])).toBe(inLog.undo[0].group);
    expect(groupOf(undefined)).toBeNull();
  });

  it('refuses a stale Plan and changes nothing', async () => {
    const h = fakeHost([note('in', 'a\n\nmove me', 'Inbox'), note('pr', '# P')]);
    const plan = must(planRefile(h.notes, { from: 'in', first: 2, last: 2, to: 'pr', target: { line: 0 } }));
    h.host.update('pr', { body: '# P edited' });
    const r = await applyPlan(plan, h.host);
    expect(r).toMatchObject({ ok: false, code: 'stale' });
    expect(h.notes[0].body).toBe('a\n\nmove me');
    expect(h.host.log('in').undo).toEqual([]);
  });
});

describe('undoGroup and redoGroup', () => {
  it('reverts every note of a refile at once and moves the steps to redo, then redoes', async () => {
    const h = fakeHost([note('in', 'a\n\nmove me', 'Inbox'), note('pr', '# P')]);
    const plan = must(planRefile(h.notes, { from: 'in', first: 2, last: 2, to: 'pr', target: { line: 0 } }));
    await applyPlan(plan, h.host);
    const group = h.host.log('in').undo[0].group!;
    const undone = await undoGroup(group, h.host);
    expect(undone.ok).toBe(true);
    expect(h.notes.map((n) => n.body)).toEqual(['a\n\nmove me', '# P']);
    expect(h.host.log('in').undo).toEqual([]);
    expect(h.host.log('in').redo).toEqual([{ text: 'a\n\nmove me', caret: 0, group }]);
    expect(h.host.log('pr').redo[0].group).toBe(group);
    const redone = await redoGroup(group, h.host);
    expect(redone.ok).toBe(true);
    expect(h.notes.map((n) => n.body)).toEqual(['a', '# P\n\nmove me']);
    expect(h.host.log('pr').redo).toEqual([]);
    expect(h.host.log('pr').undo[0].group).toBe(group);
  });

  it('refuses to undo once any touched note has changed since', async () => {
    const h = fakeHost([note('in', 'a\n\nmove me', 'Inbox'), note('pr', '# P')]);
    const plan = must(planRefile(h.notes, { from: 'in', first: 2, last: 2, to: 'pr', target: { line: 0 } }));
    await applyPlan(plan, h.host);
    const group = h.host.log('in').undo[0].group!;
    h.host.update('pr', { body: '# P\n\nmove me\n\ntyped since' });
    const r = await undoGroup(group, h.host);
    expect(r).toMatchObject({ ok: false, code: 'stale' });
    expect(r.ok ? '' : r.message).toContain('changed meanwhile');
    expect(h.notes[0].body).toBe('a');
    // The steps stay where they were, for when the note is put back.
    expect(h.host.log('in').undo).toHaveLength(1);
  });

  it('undoes a merge by restoring the source from the trash with the links, and redoes it', async () => {
    const h = fakeHost([note('s', 'dup', 'Dup'), note('t', 'keep', 'Plan'), note('o', '[[Dup]]')]);
    const plan = must(planMerge(h.notes, { source: 's', into: 't' }));
    await applyPlan(plan, h.host);
    expect(h.notes.map((n) => n.id)).toEqual(['t', 'o']);
    expect(h.trash.map((n) => n.id)).toEqual(['s']);
    const group = h.host.log('s').undo[0].group!;
    expect(await undoGroup(group, h.host)).toMatchObject({ ok: true });
    expect(h.notes.map((n) => [n.id, n.body])).toEqual([
      ['s', 'dup'],
      ['t', 'keep'],
      ['o', '[[Dup]]'],
    ]);
    expect(h.trash).toEqual([]);
    expect(await redoGroup(group, h.host)).toMatchObject({ ok: true });
    expect(h.notes.map((n) => n.id)).toEqual(['t', 'o']);
    expect(h.notes[1].body).toBe('[[Plan]]');
  });

  it('cannot undo a merge whose source was purged from the trash', async () => {
    const h = fakeHost([note('s', 'dup', 'Dup'), note('t', 'keep', 'Plan')]);
    const plan = must(planMerge(h.notes, { source: 's', into: 't' }));
    await applyPlan(plan, h.host);
    const group = h.host.log('s').undo[0].group!;
    h.trash.length = 0;
    expect(await undoGroup(group, h.host)).toMatchObject({ ok: false, code: 'gone' });
  });

  it('puts a title back on undo of a rename', async () => {
    const h = fakeHost([note('a', 'x', 'Old'), note('b', '[[Old]]')]);
    const plan = must(planRename(h.notes, { id: 'a', title: 'New', links: true }));
    await applyPlan(plan, h.host);
    expect(h.notes[0].title).toBe('New');
    expect(h.notes[1].body).toBe('[[New]]');
    await undoGroup(h.host.log('a').undo[0].group!, h.host);
    expect(h.notes[0].title).toBe('Old');
    expect(h.notes[1].body).toBe('[[Old]]');
  });

  it('answers an unknown group', async () => {
    const h = fakeHost([]);
    expect(await undoGroup('nope', h.host)).toMatchObject({ ok: false, code: 'gone' });
    expect(await redoGroup('nope', h.host)).toMatchObject({ ok: false, code: 'gone' });
  });
});
