// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dueToken, setTaskDue, taskDue, tasksIn } from '../renderer/tasks';
import type { Note } from '../shared/types';
import { dueLabel, dueTasks, inWindow, parseDueMoment, parseDueWindow, reminderAt, taskText } from './due';

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const now = local(2026, 9, 3, 12, 0);
const note = (id: string, body: string, title?: string): Note => ({ id, body, createdAt: 1, updatedAt: 1, ...(title ? { title } : {}) });

describe('taskDue / tasksIn', () => {
  it('reads a date, a date with a time, and refuses an impossible day', () => {
    expect(taskDue('- [ ] pay rent @2026-09-10')).toMatchObject({ at: local(2026, 9, 10), hasTime: false, token: '@2026-09-10' });
    expect(taskDue('- [ ] call @2026-09-10 14:30 the bank')).toMatchObject({ at: local(2026, 9, 10, 14, 30), hasTime: true });
    expect(taskDue('- [ ] mail@2026-09-10')).toBeNull();
    expect(taskDue('- [ ] x @2026-13-45')).toBeNull();
    expect(tasksIn('- [ ] a @2026-09-10\n- [x] b\nc')).toEqual([
      { line: 0, done: false, due: local(2026, 9, 10), hasTime: false },
      { line: 1, done: true },
    ]);
  });
});

describe('setTaskDue', () => {
  it('adds, replaces and removes the date, making a task of a plain line', () => {
    expect(setTaskDue('plain', 0, { at: local(2026, 9, 10), withTime: false })).toBe('- [ ] plain @2026-09-10');
    expect(setTaskDue('- [ ] a @2026-09-10 tail', 0, { at: local(2026, 9, 11, 9, 5), withTime: true })).toBe('- [ ] a tail @2026-09-11 09:05');
    expect(setTaskDue('- [x] a @2026-09-10', 0, null)).toBe('- [x] a');
    expect(dueToken(local(2026, 1, 2, 3, 4), true)).toBe('@2026-01-02 03:04');
  });
});

describe('dueTasks', () => {
  const notes = [
    note('a', '- [ ] rent @2026-09-10\n- [x] paid @2026-09-01\n- [ ] undated', 'Money'),
    note('b', 'x\n- [ ] dentist @2026-09-03 15:00 #health'),
  ];
  it('lists undone dated tasks soonest first, with their words', () => {
    const due = dueTasks(notes);
    expect(due.map((t) => [t.noteTitle, t.text, t.line])).toEqual([
      ['x', 'dentist #health', 1],
      ['Money', 'rent', 0],
    ]);
    expect(dueTasks(notes, { includeDone: true })).toHaveLength(3);
    expect(taskText('  - [x] a  @2026-09-10 14:00  b')).toBe('a b');
  });
  it('understands the windows the command line and the search box use', () => {
    expect(parseDueWindow('today', now)).toEqual({ until: local(2026, 9, 3, 23, 59) + 59999 });
    expect(parseDueWindow('tomorrow', now)).toEqual({ from: local(2026, 9, 4), until: local(2026, 9, 4, 23, 59) + 59999 });
    expect(parseDueWindow('overdue', now)).toEqual({ until: now });
    expect(parseDueWindow('7d', now)?.until).toBe(local(2026, 9, 10, 23, 59) + 59999);
    expect(parseDueWindow('2026-09-10', now)).toEqual({ from: local(2026, 9, 10), until: local(2026, 9, 10, 23, 59) + 59999 });
    expect(parseDueWindow('any', now)).toEqual({});
    expect(parseDueWindow('soon', now)).toBeNull();
    expect(inWindow({ due: local(2026, 9, 3, 15) }, parseDueWindow('today', now) as never)).toBe(true);
    expect(inWindow({ due: local(2026, 9, 10) }, parseDueWindow('today', now) as never)).toBe(false);
  });
  it('labels a due moment relative to today and fires date-only reminders at nine', () => {
    expect(dueLabel(local(2026, 9, 3, 15), true, now)).toBe('today 15:00');
    expect(dueLabel(local(2026, 9, 4), false, now)).toBe('tomorrow');
    expect(dueLabel(local(2026, 9, 1), false, now)).toBe('2 d overdue');
    expect(dueLabel(local(2026, 9, 7), false, now)).toBe('Mon');
    expect(dueLabel(local(2026, 10, 20), false, now)).toBe('20 Oct');
    expect(reminderAt({ due: local(2026, 9, 10), hasTime: false })).toBe(local(2026, 9, 10, 9));
    expect(reminderAt({ due: local(2026, 9, 10, 14, 30), hasTime: true })).toBe(local(2026, 9, 10, 14, 30));
  });
});

describe('parseDueMoment', () => {
  it('reads the ways a due moment is typed on a command line', () => {
    expect(parseDueMoment('today', now)).toEqual({ at: local(2026, 9, 3), withTime: false });
    expect(parseDueMoment('tomorrow 14:30', now)).toEqual({ at: local(2026, 9, 4, 14, 30), withTime: true });
    expect(parseDueMoment('+3d', now)).toEqual({ at: local(2026, 9, 6), withTime: false });
    expect(parseDueMoment('2w', now)).toEqual({ at: local(2026, 9, 17), withTime: false });
    expect(parseDueMoment('mon', now)).toEqual({ at: local(2026, 9, 7), withTime: false });
    expect(parseDueMoment('thursday', now)).toEqual({ at: local(2026, 9, 10), withTime: false });
    expect(parseDueMoment('2026-09-10', now)).toEqual({ at: local(2026, 9, 10), withTime: false });
    expect(parseDueMoment('2026-09-10 09:05', now)).toEqual({ at: local(2026, 9, 10, 9, 5), withTime: true });
    expect(parseDueMoment('2026-09-10T09:05', now)).toEqual({ at: local(2026, 9, 10, 9, 5), withTime: true });
    expect(parseDueMoment('16:00', now)).toEqual({ at: local(2026, 9, 3, 16), withTime: true });
    expect(parseDueMoment('2026-02-30', now)).toBeNull();
    expect(parseDueMoment('whenever', now)).toBeNull();
  });
});

describe('dates the calendar does not have', () => {
  it('refuses an impossible month or day instead of rolling it over', () => {
    expect(parseDueMoment('2026-13-01', now)).toBeNull();
    expect(parseDueMoment('2026-02-30', now)).toBeNull();
    expect(parseDueMoment('2026-02-28', now)).toEqual({ at: local(2026, 2, 28), withTime: false });
    expect(parseDueWindow('2026-13-01', now)).toBeNull();
    expect(parseDueWindow('2026-02-30', now)).toBeNull();
    expect(parseDueWindow('2026-02-28', now)?.from).toBe(local(2026, 2, 28));
  });
});
