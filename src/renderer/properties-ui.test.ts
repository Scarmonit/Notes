import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPropertiesUi, type PropertiesHost, type PropertiesUi } from './properties-ui';
import type { NoteProperty } from '../shared/properties';
import type { Note } from '../shared/types';

const prop = (key: string, value: NoteProperty['value'], occurrence = 1, complex = false): NoteProperty => ({ key, value, occurrence, complex });

function note(id: string, title: string, properties?: NoteProperty[]): Note {
  const n: Note = { id, body: `${title} body`, createdAt: 1, updatedAt: 2, title };
  if (properties) n.properties = properties;
  return n;
}

interface Harness {
  ui: PropertiesUi;
  host: PropertiesHost;
  written: Array<{ id: string; change: unknown }>;
  searched: string[];
  card: () => HTMLElement;
  rows: () => string[];
}

function harness(notes: Note[], selectedId = notes[0]?.id): Harness {
  document.body.innerHTML = '';
  const written: Array<{ id: string; change: unknown }> = [];
  const searched: string[] = [];
  let list = notes;
  const host: PropertiesHost = {
    notes: () => list,
    selected: () => list.find((n) => n.id === selectedId) ?? null,
    write: async (id, change) => {
      written.push({ id, change });
      return null;
    },
    writeAliases: (id, names) => {
      list = list.map((n) => (n.id === id ? { ...n, aliases: names } : n));
    },
    search: (q) => searched.push(q),
    status: vi.fn(),
    focusEditor: vi.fn(),
    root: document.body,
  };
  const ui = createPropertiesUi(host);
  const card = (): HTMLElement => document.querySelector('.sheet-card') as HTMLElement;
  const rows = (): string[] => [...document.querySelectorAll('.props-row .props-key-name')].map((e) => e.textContent ?? '');
  return { ui, host, written, searched, card, rows };
}

describe('the properties sheet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows nothing at all until it is asked for, and closes on Esc', () => {
    const h = harness([note('a', 'Plan', [prop('status', 'draft')])]);
    expect(document.querySelector('.sheet')).toBe(null);
    h.ui.open();
    expect(h.ui.isOpen()).toBe(true);
    expect(h.rows()).toEqual(['status']);
    expect(h.ui.close()).toBe(true);
    expect(document.querySelector('.sheet')).toBe(null);
  });

  it('says so plainly when a note carries none', () => {
    const h = harness([note('a', 'Plan')]);
    h.ui.open();
    expect(h.card().querySelector('.props-empty')?.textContent).toContain('no properties');
  });

  it('lists a key written twice as two rows, each marked and numbered', () => {
    const h = harness([note('a', 'Plan', [prop('status', 'draft', 1), prop('status', 'final', 2)])]);
    h.ui.open();
    expect(h.rows()).toEqual(['status', 'status']);
    expect([...document.querySelectorAll('.props-dup')].map((e) => e.textContent)).toEqual(['1 of 2', '2 of 2']);
  });

  it('changes only the occurrence whose row was edited', () => {
    const h = harness([note('a', 'Plan', [prop('status', 'draft', 1), prop('status', 'final', 2)])]);
    h.ui.open();
    const second = document.querySelectorAll<HTMLInputElement>('.props-row .props-value')[1];
    second.value = 'later';
    second.dispatchEvent(new Event('blur'));
    expect(h.written).toEqual([{ id: 'a', change: { key: 'status', value: 'later', occurrence: 2 } }]);
  });

  it('reads what was typed the same conservative way the file is read', () => {
    const h = harness([note('a', 'Plan', [prop('flag', 'x')])]);
    h.ui.open();
    const box = document.querySelector<HTMLInputElement>('.props-row .props-value')!;
    for (const [typed, meant] of [
      ['true', true],
      ['null', null],
      ['42', 42],
      ['yes', 'yes'],
      ['2026-09-06', '2026-09-06'],
    ] as Array<[string, unknown]>) {
      box.value = typed;
      box.dispatchEvent(new Event('blur'));
      expect((h.written[h.written.length - 1].change as { value: unknown }).value, typed).toEqual(meant);
    }
  });

  it('shows a complex value but offers no way to edit it', () => {
    const h = harness([note('a', 'Plan', [prop('config', null, 1, true)])]);
    h.ui.open();
    expect(h.card().querySelector('.props-type')?.textContent).toBe('complex');
    expect(h.card().querySelector('.props-complex input')).toBe(null);
    // It can still be taken off: leaving it alone is the default, not the only choice.
    expect(h.card().querySelector('.props-row .props-remove')).not.toBe(null);
  });

  it('removes a property in one press, without arming', () => {
    const h = harness([note('a', 'Plan', [prop('status', 'draft')])]);
    h.ui.open();
    h.card().querySelector<HTMLButtonElement>('.props-remove')!.click();
    expect(h.written).toEqual([{ id: 'a', change: { key: 'status', occurrence: 1 } }]);
  });

  it('offers the notebook’s own words when a key is being typed, commonest first', () => {
    const h = harness([note('a', 'Plan'), note('b', 'One', [prop('status', 'draft')]), note('c', 'Two', [prop('status', 'final')]), note('d', 'Three', [prop('stage', 'two')])]);
    h.ui.open();
    h.card().querySelector<HTMLButtonElement>('.props-start')!.click();
    const key = document.querySelector<HTMLInputElement>('.props-new-key')!;
    key.value = 'sta';
    key.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('.props-complete-row span:first-child')].map((e) => e.textContent)).toEqual(['status', 'stage']);
    expect(document.querySelector('.props-count')?.textContent).toContain('2 notes');
  });

  it('refuses a key that is not a name a property can have', () => {
    const h = harness([note('a', 'Plan')]);
    h.ui.open();
    h.card().querySelector<HTMLButtonElement>('.props-start')!.click();
    const key = document.querySelector<HTMLInputElement>('.props-new-key')!;
    const value = document.querySelector<HTMLInputElement>('.props-new-value')!;
    key.value = 'not a key';
    value.value = 'x';
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.written).toEqual([]);
    expect(h.host.status).toHaveBeenCalledWith(expect.stringContaining('not a name'), expect.any(Number));
  });

  it('edits a list a row at a time, and reorders with Alt and an arrow', () => {
    const h = harness([note('a', 'Plan', [prop('people', ['Sam', 'Alex'])])]);
    h.ui.open();
    const items = document.querySelectorAll<HTMLInputElement>('.props-item');
    expect([...items].map((i) => i.value)).toEqual(['Sam', 'Alex']);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    expect(h.written[0].change).toEqual({ key: 'people', value: ['Alex', 'Sam'], occurrence: 1 });
  });

  it('shows the note’s own fields, and edits aliases here rather than in a second sheet', () => {
    const h = harness([{ ...note('a', 'Plan'), aliases: ['P'] }]);
    h.ui.open('aliases');
    expect([...document.querySelectorAll('.props-field .props-key')].map((e) => e.textContent)).toEqual(['title', 'aliases', 'pinned', 'created', 'updated']);
    const box = document.querySelector<HTMLInputElement>('[data-value-for="aliases"]')!;
    expect(box.value).toBe('P');
    box.value = 'P, Plan B';
    box.dispatchEvent(new Event('blur'));
    expect(h.host.notes()[0].aliases).toEqual(['P', 'Plan B']);
    // And the note's own fields are not offered as YAML to write.
    expect(h.written).toEqual([]);
  });
});

describe('the vocabulary sheet', () => {
  const notes = [
    note('a', 'One', [prop('status', 'draft')]),
    note('b', 'Two', [prop('status', 'draft')]),
    note('c', 'Three', [prop('status', 'final'), prop('Status', 'shouted')]),
  ];

  it('lists every key with its count and its casing variants', () => {
    const h = harness(notes);
    h.ui.openVocabulary();
    const keys = [...document.querySelectorAll('.vocab-key')].map((e) => e.textContent);
    expect(keys).toEqual(['status', 'Status']);
    expect(document.querySelector('.vocab-count')?.textContent).toContain('3 notes');
    expect(document.querySelector('.vocab-count')?.textContent).toContain('also Status');
  });

  it('searches for a key, and closes', () => {
    const h = harness(notes);
    h.ui.openVocabulary();
    document.querySelector<HTMLButtonElement>('.vocab-key')!.click();
    expect(h.searched).toEqual(['prop:status']);
    expect(h.ui.isOpen()).toBe(false);
  });

  it('unfolds a key’s values and searches for one', () => {
    const h = harness(notes);
    h.ui.openVocabulary();
    document.querySelector<HTMLButtonElement>('.vocab-more')!.click();
    expect([...document.querySelectorAll('.vocab-value span:first-child')].map((e) => e.textContent)).toEqual(['draft', 'final']);
    document.querySelector<HTMLButtonElement>('.vocab-value')!.click();
    expect(h.searched).toEqual(['prop:status=draft']);
  });

  it('quotes an operand that would not survive the search box', () => {
    const h = harness([note('a', 'One', [prop('review_status', 'needs review')])]);
    h.ui.openVocabulary();
    document.querySelector<HTMLButtonElement>('.vocab-more')!.click();
    document.querySelector<HTMLButtonElement>('.vocab-value')!.click();
    expect(h.searched).toEqual(['prop:"review_status=needs review"']);
  });
});
