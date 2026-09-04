import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlash, inInlineCode, inTableRow, matchSlash, sessionStart, type SlashHost, type SlashItem } from './slash';

describe('where a slash session begins', () => {
  it('starts at a line, or after whitespace, and nowhere else', () => {
    expect(sessionStart('/', 1)).toBe(0);
    expect(sessionStart('write /', 7)).toBe(6);
    expect(sessionStart('  /ta', 5)).toBe(2);
    // The two things that must never open it: a word with a slash in it, and
    // a path somebody is typing.
    expect(sessionStart('and/or', 6)).toBe(-1);
    expect(sessionStart('C:/Users/scarm', 14)).toBe(-1);
    expect(sessionStart('no slash here', 13)).toBe(-1);
  });

  it('lets the query hold spaces, because a command label does', () => {
    expect(sessionStart('/insert the', 11)).toBe(0);
  });

  it('knows a slash inside inline code, and a table row', () => {
    expect(inInlineCode('a `x/y` b', 5)).toBe(true);
    expect(inInlineCode('a `x` /', 6)).toBe(false);
    expect(inTableRow('| a | b |')).toBe(true);
    expect(inTableRow('plain words')).toBe(false);
  });
});

describe('matchSlash', () => {
  const items: SlashItem[] = [
    { id: 'task', label: 'Insert a task', terms: 'todo checkbox', run: () => undefined },
    { id: 'date', label: 'Insert the date', terms: 'today', run: () => undefined },
    { id: 'table', label: 'Table', run: () => undefined },
  ];

  it('keeps registry order and matches label, hint and terms', () => {
    expect(matchSlash(items, '').map((i) => i.id)).toEqual(['task', 'date', 'table']);
    expect(matchSlash(items, 'ta').map((i) => i.id)).toEqual(['task', 'table']);
    expect(matchSlash(items, 'checkbox').map((i) => i.id)).toEqual(['task']);
    expect(matchSlash(items, 'nothing')).toEqual([]);
  });
});

interface Harness {
  slash: ReturnType<typeof createSlash>;
  line: (text: string, column?: number) => void;
  ran: string[];
  removed: number[];
}

function harness(): Harness {
  document.body.innerHTML = '';
  const ran: string[] = [];
  const removed: number[] = [];
  let caret: { line: string; column: number } | null = null;
  const items: SlashItem[] = [
    { id: 'task', label: 'Insert a task', chord: 'ctrl+shift+t', run: () => ran.push('task') },
    { id: 'date', label: 'Insert the date', chord: 'ctrl+;', run: () => ran.push('date') },
    { id: 'table', label: 'Table', run: () => ran.push('table') },
  ];
  const host: SlashHost = {
    items: () => items,
    caret: () => caret,
    caretBox: () => ({ left: 100, top: 100, right: 100, bottom: 116 }),
    runWith: (n, run) => {
      removed.push(n);
      run();
    },
    root: document.body,
  };
  const slash = createSlash(host);
  return {
    slash,
    line: (text, column) => {
      caret = { line: text, column: column ?? text.length };
      slash.sync();
    },
    ran,
    removed,
  };
}

const rows = (): string[] => [...document.querySelectorAll('.slash-row .slash-label')].map((e) => e.textContent ?? '');

describe('the slash menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens on a slash that starts a line and filters as more is typed', () => {
    const h = harness();
    h.line('/');
    expect(h.slash.isOpen()).toBe(true);
    expect(rows()).toEqual(['Insert a task', 'Insert the date', 'Table']);
    h.line('/dat');
    expect(rows()).toEqual(['Insert the date']);
  });

  it('never opens mid-word, in code, or in a table row', () => {
    const h = harness();
    h.line('and/or');
    expect(h.slash.isOpen()).toBe(false);
    h.line('`a/b`', 3);
    expect(h.slash.isOpen()).toBe(false);
    h.line('| a | / |');
    expect(h.slash.isOpen()).toBe(false);
  });

  it('says so rather than closing when nothing matches, so the query is not lost', () => {
    const h = harness();
    h.line('/zzz');
    expect(h.slash.isOpen()).toBe(true);
    expect(document.querySelector('.slash-empty')?.textContent).toBe('No matching insert command');
  });

  it('prints the chord beside a command that has one, and nothing where there is none', () => {
    const h = harness();
    h.line('/');
    const keys = [...document.querySelectorAll('.slash-row .slash-keys')].map((e) => e.textContent);
    expect(keys[0]).toContain('Ctrl');
    expect(keys[2]).toBe('');
  });

  it('takes its own keys and leaves everything else to the editor', () => {
    const h = harness();
    h.line('/');
    const key = (k: string): boolean => h.slash.key(new KeyboardEvent('keydown', { key: k, cancelable: true }));
    expect(key('ArrowDown')).toBe(true);
    expect(document.querySelectorAll('.slash-row')[1].classList.contains('at')).toBe(true);
    expect(key('ArrowUp')).toBe(true);
    expect(document.querySelectorAll('.slash-row')[0].classList.contains('at')).toBe(true);
    // A letter is typing, not navigation.
    expect(key('a')).toBe(false);
    expect(key('Home')).toBe(false);
  });

  it('runs the selected command, taking the whole query out as one edit', () => {
    const h = harness();
    h.line('/date');
    h.slash.key(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    // Four characters of query, plus the slash: one Ctrl+Z must restore them.
    expect(h.removed).toEqual([5]);
    expect(h.ran).toEqual(['date']);
    expect(h.slash.isOpen()).toBe(false);
  });

  it('runs on Tab as well as Enter', () => {
    const h = harness();
    h.line('/tab');
    h.slash.key(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(h.ran).toEqual(['table']);
  });

  it('closes on Esc and leaves what was typed alone', () => {
    const h = harness();
    h.line('/dat');
    expect(h.slash.key(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))).toBe(true);
    expect(h.slash.isOpen()).toBe(false);
    // Nothing was removed and nothing was run: the text is the note's own.
    expect(h.removed).toEqual([]);
    expect(h.ran).toEqual([]);
  });

  it('closes when the caret walks out of the query', () => {
    const h = harness();
    h.line('/dat');
    expect(h.slash.isOpen()).toBe(true);
    h.line('/dat', 0);
    expect(h.slash.isOpen()).toBe(false);
  });

  it('holds the session open while a chooser of its own has the focus', () => {
    const h = harness();
    h.line('/temp');
    h.slash.suspend();
    // The chooser stole the focus and the caret says nothing useful; the
    // session must survive that rather than dropping the query.
    h.line('something else entirely');
    expect(h.slash.isOpen()).toBe(true);
    h.slash.resume();
    h.line('nothing here');
    expect(h.slash.isOpen()).toBe(false);
  });

  it('runs nothing when there is nothing to run', () => {
    const h = harness();
    h.line('/zzz');
    expect(h.slash.key(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(false);
    expect(h.ran).toEqual([]);
    expect(h.slash.isOpen()).toBe(true);
  });
});
