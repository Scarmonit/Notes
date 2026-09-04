import { describe, expect, it } from 'vitest';
import { cycleTaskLine, setTaskDue, taskProgress, tasksIn, toggleTaskAt, toggleTaskLine } from './tasks';

const LIST = '# Shopping\n\n- [ ] bread\n- [x] milk\n* [ ] jam\n\nnot a task';

describe('tasksIn', () => {
  it('finds every task line, whatever bullet it uses', () => {
    expect(tasksIn(LIST)).toEqual([
      { line: 2, done: false },
      { line: 3, done: true },
      { line: 4, done: false },
    ]);
  });

  it('ignores list items and text that only look like tasks', () => {
    expect(tasksIn('- plain item\n[ ] no bullet\n-[ ] no gap\n- [y] not a box')).toEqual([]);
  });

  it('counts indented tasks, which is how sub-lists are written', () => {
    expect(tasksIn('- [ ] top\n  - [x] under it')).toEqual([
      { line: 0, done: false },
      { line: 1, done: true },
    ]);
  });
});

describe('taskProgress', () => {
  it('reports how much of a list is done', () => {
    expect(taskProgress(LIST)).toEqual({ done: 1, total: 3 });
    expect(taskProgress('no tasks here')).toEqual({ done: 0, total: 0 });
  });
});

describe('toggleTaskAt', () => {
  it('ticks the nth checkbox, counting the way the preview draws them', () => {
    // The second box is milk, already done, so ticking it clears it.
    expect(toggleTaskAt(LIST, 1)).toContain('- [ ] milk');
    expect(toggleTaskAt(LIST, 0)).toContain('- [x] bread');
  });

  it('leaves the rest of the note exactly as it was', () => {
    const next = toggleTaskAt(LIST, 2);
    expect(next.split('\n').filter((_l, i) => i !== 4)).toEqual(LIST.split('\n').filter((_l, i) => i !== 4));
    expect(next.split('\n')[4]).toBe('* [x] jam');
  });

  it('does nothing when there is no such task', () => {
    expect(toggleTaskAt(LIST, 9)).toBe(LIST);
  });

  it('keeps the indent and the bullet character it found', () => {
    expect(toggleTaskLine('   + [ ] indented', 0)).toBe('   + [x] indented');
  });
});

describe('cycleTaskLine', () => {
  it('walks a line from text, to unticked, to ticked, and back to text', () => {
    const plain = 'buy stamps';
    const todo = cycleTaskLine(plain, 0);
    expect(todo).toBe('- [ ] buy stamps');
    const done = cycleTaskLine(todo, 0);
    expect(done).toBe('- [x] buy stamps');
    expect(cycleTaskLine(done, 0)).toBe('- buy stamps');
  });

  it('turns an existing list item into a task without adding a second bullet', () => {
    expect(cycleTaskLine('  * an item', 0)).toBe('  * [ ] an item');
  });

  it('keeps the indent of the line it is given', () => {
    expect(cycleTaskLine('    nested', 0)).toBe('    - [ ] nested');
  });

  it('touches only the line asked for', () => {
    expect(cycleTaskLine('first\nsecond', 1)).toBe('first\n- [ ] second');
  });

  it('starts a task on an empty line', () => {
    expect(cycleTaskLine('', 0)).toBe('- [ ] ');
  });

  it('leaves the body alone when the line does not exist', () => {
    expect(cycleTaskLine('one line', 4)).toBe('one line');
  });
});

describe('tasksIn mirrors the checkboxes the preview draws', () => {
  it('skips a task inside a code fence, so the nth line is the nth box', () => {
    const body = '```\n- [ ] in code\n```\n- [ ] real';
    expect(tasksIn(body)).toEqual([{ line: 3, done: false }]);
    expect(toggleTaskAt(body, 0)).toBe('```\n- [ ] in code\n```\n- [x] real');
  });

  it('counts tasks in ordered lists and quotes, which the preview also draws as boxes', () => {
    expect(tasksIn('1. [ ] numbered\n> - [x] quoted\n- [ ]\ttab')).toEqual([
      { line: 0, done: false },
      { line: 1, done: true },
    ]);
    expect(toggleTaskLine('1. [ ] numbered', 0)).toBe('1. [x] numbered');
    expect(toggleTaskLine('> - [x] quoted', 0)).toBe('> - [ ] quoted');
  });
});

describe('setTaskDue keeps the line where it was', () => {
  it('leaves the indent that nests a task under its parent', () => {
    const body = '- [ ] parent\n    - [ ] child  x @2026-09-10';
    expect(setTaskDue(body, 1, { at: new Date(2026, 8, 12).getTime(), withTime: false })).toBe('- [ ] parent\n    - [ ] child x @2026-09-12');
    expect(setTaskDue(body, 1, null)).toBe('- [ ] parent\n    - [ ] child x');
    expect(setTaskDue('- [ ] @2026-09-10 first', 0, null)).toBe('- [ ] first');
  });
});

describe('tasksIn and indented code', () => {
  it('draws no checkbox for a task-looking line in an indented code block, as the preview does not', () => {
    expect(tasksIn('para\n\n    - [ ] code\n- [ ] real')).toEqual([{ line: 3, done: false }]);
    expect(tasksIn('para\n\n    - [ ] code\n    - [x] more code\n\n- [ ] real')).toEqual([{ line: 5, done: false }]);
    expect(toggleTaskAt('para\n\n    - [ ] code\n- [ ] real', 0)).toBe('para\n\n    - [ ] code\n- [x] real');
  });
  it('still counts a nested task after a blank line inside a list, and a lazily continued one', () => {
    expect(tasksIn('- [ ] a\n\n    - [ ] b')).toEqual([
      { line: 0, done: false },
      { line: 2, done: false },
    ]);
    expect(tasksIn('- item\ntext\n\n    - [ ] under')).toEqual([{ line: 3, done: false }]);
    expect(tasksIn('    - [ ] first line of the note')).toEqual([]);
  });
});
