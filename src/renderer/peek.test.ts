import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_MS, createPeek, MAX_SOURCE, OPEN_MS, type Peek, type PeekHost } from './peek';
import { renderGlance } from './markdown';
import type { Note } from '../shared/types';

const note = (id: string, title: string, body: string, folder = ''): Note => ({ id, body, createdAt: 1, updatedAt: 2, title, folder, file: `${title}.md` });

const box = { left: 100, top: 100, right: 180, bottom: 116 };

interface Harness {
  peek: Peek;
  host: PeekHost;
  opened: Array<{ id: string; block?: string }>;
  setNotes: (list: Note[]) => void;
}

function harness(list: Note[], hover = true): Harness {
  document.body.innerHTML = '';
  let notes = list;
  const opened: Array<{ id: string; block?: string }> = [];
  const host: PeekHost = {
    notes: () => notes,
    render: renderGlance,
    open: (id, address) => opened.push(address?.block ? { id, block: address.block } : { id }),
    hoverAllowed: () => hover,
    root: document.body,
  };
  return { peek: createPeek(host), host, opened, setNotes: (next) => (notes = next) };
}

const card = (): HTMLElement | null => document.querySelector('.peek');
const text = (): string => card()?.textContent ?? '';

describe('what a peek shows', () => {
  const notes = [
    note('a', 'Plan', 'The opening.\n\n- The decision ^k3n9dq\n  - and the detail\n\n## A heading\n\nUnder it.'),
    note('b', 'Elsewhere', 'See [[Plan]].'),
    note('w', 'Plan', 'The work one.', 'Work'),
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the block an address names, and only that', () => {
    const h = harness([notes[0], notes[1]]);
    h.peek.show({ address: 'Plan#^k3n9dq' }, box, true);
    expect(text()).toContain('The decision');
    expect(text()).toContain('and the detail');
    expect(text()).not.toContain('The opening');
    // The address is the citation, never part of the words.
    expect(text()).not.toContain('decision ^');
  });

  it('shows a heading’s section, and the whole note when nothing is named', () => {
    const h = harness([notes[0]]);
    h.peek.show({ address: 'Plan#A heading' }, box, true);
    expect(text()).toContain('Under it.');
    expect(text()).not.toContain('The opening');
    h.peek.show({ address: 'Plan' }, box, true);
    expect(text()).toContain('The opening');
  });

  it('reads an empty name as the note the link is written in', () => {
    const h = harness([notes[0]]);
    h.peek.show({ address: '#^k3n9dq', fromId: 'a' }, box, true);
    expect(text()).toContain('The decision');
  });

  it('says what is missing rather than showing nothing', () => {
    const h = harness([notes[0]]);
    h.peek.show({ address: 'Nothing at all' }, box, true);
    expect(document.querySelector('.peek-why')?.textContent).toContain('No note called');
    h.peek.show({ address: 'Plan#^missing' }, box, true);
    expect(document.querySelector('.peek-why')?.textContent).toContain('was not found');
    h.peek.show({ address: 'Plan#No such heading' }, box, true);
    expect(document.querySelector('.peek-why')?.textContent).toContain('no heading');
  });

  it('shows both candidates, with their folders, for a name two notes answer to', () => {
    const h = harness(notes);
    h.peek.show({ address: 'Plan' }, box, true);
    expect(document.querySelector('.peek-name')?.textContent).toContain('names 2 notes');
    expect([...document.querySelectorAll('.peek-candidate-where')].map((e) => e.textContent)).toEqual(['the root', 'Work']);
    // Choosing one goes there, which is what makes the card useful.
    document.querySelectorAll<HTMLButtonElement>('.peek-candidate')[1].click();
    expect(h.opened).toEqual([{ id: 'w' }]);
  });

  it('cuts a very long note and says so', () => {
    const long = note('l', 'Long', `${'word '.repeat(4000)}\n\nthe end`);
    const h = harness([long]);
    h.peek.show({ address: 'Long' }, box, true);
    expect(document.querySelector('.peek-more')?.textContent).toBe('Open note to continue');
    expect(text()).not.toContain('the end');
    expect(long.body.length).toBeGreaterThan(MAX_SOURCE);
  });

  it('names a diagram and an embed rather than drawing either', () => {
    const h = harness([note('d', 'Drawn', '```mermaid\ngraph TD;\nA-->B;\n```\n\n![[Plan]]\n')]);
    h.peek.show({ address: 'Drawn' }, box, true);
    expect(text()).toContain('Mermaid diagram');
    expect(text()).toContain('Embedded: Plan');
    expect(card()?.querySelector('[data-diagram]')).toBe(null);
    expect(card()?.querySelector('.embed')).toBe(null);
  });

  it('renders a task but never lets it be ticked', () => {
    const h = harness([note('t', 'Tasks', '- [ ] a thing\n- [x] a done thing')]);
    h.peek.show({ address: 'Tasks' }, box, true);
    const boxes = card()!.querySelectorAll('input');
    expect(boxes.length).toBe(2);
    expect([...boxes].every((b) => b.disabled)).toBe(true);
  });

  it('follows a link inside the card rather than opening a second one', () => {
    const h = harness([note('a', 'Plan', 'to [[Elsewhere]]'), note('b', 'Elsewhere', 'here')]);
    h.peek.show({ address: 'Plan' }, box, true);
    card()!.querySelector<HTMLElement>('[data-link]')!.click();
    expect(h.opened).toEqual([{ id: 'b' }]);
    expect(h.peek.isOpen()).toBe(false);
  });
});

describe('when a peek opens and closes', () => {
  const notes = [note('a', 'Plan', 'The opening.')];

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits out the dwell before it opens', () => {
    const h = harness(notes);
    h.peek.hover({ address: 'Plan' }, () => box);
    vi.advanceTimersByTime(OPEN_MS - 50);
    expect(h.peek.isOpen()).toBe(false);
    vi.advanceTimersByTime(60);
    expect(h.peek.isOpen()).toBe(true);
  });

  it('never opens on hover while the setting is off, and always opens on command', () => {
    const h = harness(notes, false);
    h.peek.hover({ address: 'Plan' }, () => box);
    vi.advanceTimersByTime(OPEN_MS * 2);
    expect(h.peek.isOpen()).toBe(false);
    h.peek.show({ address: 'Plan' }, box, true);
    expect(h.peek.isOpen()).toBe(true);
  });

  it('lingers after the pointer leaves, then goes', () => {
    const h = harness(notes);
    h.peek.hover({ address: 'Plan' }, () => box);
    vi.advanceTimersByTime(OPEN_MS);
    h.peek.unhover();
    vi.advanceTimersByTime(CLOSE_MS - 40);
    expect(h.peek.isOpen()).toBe(true);
    vi.advanceTimersByTime(60);
    expect(h.peek.isOpen()).toBe(false);
  });

  it('keeps the card when the pointer comes back to the same thing', () => {
    const h = harness(notes);
    h.peek.hover({ address: 'Plan' }, () => box);
    vi.advanceTimersByTime(OPEN_MS);
    const first = card();
    h.peek.unhover();
    h.peek.hover({ address: 'Plan' }, () => box);
    vi.advanceTimersByTime(OPEN_MS);
    expect(card()).toBe(first);
  });

  it('stays put when it was asked for by name, whatever the pointer does', () => {
    const h = harness(notes);
    h.peek.show({ address: 'Plan' }, box, true);
    expect(h.peek.isPinned()).toBe(true);
    h.peek.unhover();
    vi.advanceTimersByTime(CLOSE_MS * 4);
    expect(h.peek.isOpen()).toBe(true);
  });

  it('has never more than one card', () => {
    const h = harness([...notes, note('b', 'Elsewhere', 'other')]);
    h.peek.show({ address: 'Plan' }, box, true);
    h.peek.show({ address: 'Elsewhere' }, box, true);
    expect(document.querySelectorAll('.peek').length).toBe(1);
    expect(text()).toContain('other');
  });
});

describe('what a peek remembers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a fragment once and keeps it', () => {
    const h = harness([note('a', 'Plan', 'words'), note('b', 'Other', 'more')]);
    const render = vi.spyOn(h.host, 'render');
    h.peek.show({ address: 'Plan' }, box, true);
    h.peek.hide();
    h.peek.show({ address: 'Plan' }, box, true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(h.peek.cached()).toBe(1);
  });

  it('forgets a note whose words have moved on', () => {
    const h = harness([note('a', 'Plan', 'words')]);
    h.peek.show({ address: 'Plan' }, box, true);
    expect(h.peek.cached()).toBe(1);
    h.peek.forget('a');
    expect(h.peek.cached()).toBe(0);
  });

  it('remembers a heading and a block apart from the note holding them', () => {
    const h = harness([note('a', 'Plan', 'One. ^abc123\n\n## Head\n\nUnder.')]);
    h.peek.show({ address: 'Plan' }, box, true);
    h.peek.show({ address: 'Plan#^abc123' }, box, true);
    h.peek.show({ address: 'Plan#Head' }, box, true);
    expect(h.peek.cached()).toBe(3);
  });

  it('keeps no more than the last thirty-two', () => {
    const many = Array.from({ length: 40 }, (_, i) => note(`n${i}`, `Note ${i}`, `body ${i}`));
    const h = harness(many);
    for (const n of many) h.peek.show({ address: `Note ${many.indexOf(n)}` }, box, true);
    expect(h.peek.cached()).toBe(32);
  });
});
