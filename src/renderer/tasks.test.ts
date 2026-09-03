import { describe, expect, it } from 'vitest';
import { cycleTaskLine, taskProgress, tasksIn, toggleTaskAt, toggleTaskLine } from './tasks';

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
