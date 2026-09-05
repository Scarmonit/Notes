import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery } from '../core/query';
import type { PropertyChange } from '../shared/properties';
import type { Note } from '../shared/types';
import { renderView, type ViewHost, type ViewRecord } from './viewtab';

const note = (id: string, title: string, props: Record<string, unknown>, updatedAt = 1): Note => ({
  id,
  body: `# ${title}\n\nwords of ${title}`,
  createdAt: 1,
  updatedAt,
  properties: Object.entries(props).map(([key, value]) => ({ key, value: value as never, occurrence: 1, complex: false })),
});

const NOTES = [note('a', 'Alpha', { status: 'draft', rating: 3, done: false }), note('b', 'Beta', { status: 'final', rating: 9, done: true }), note('c', 'Gamma', { status: 'draft' })];

function make(view: Partial<ViewRecord> = {}) {
  const section = document.createElement('section');
  document.body.append(section);
  const record: ViewRecord = { id: 'v1', query: 'prop:status', layout: 'table', ...view };
  const host: ViewHost = {
    run: (q) => ({ notes: NOTES, filter: parseQuery(q) }),
    vocabulary: () => ['status', 'rating', 'done', 'owner'],
    open: vi.fn(),
    setProperty: vi.fn(async (_id: string, _change: PropertyChange) => null),
    update: vi.fn(),
    pickLayout: vi.fn(),
    pick: vi.fn(),
    status: vi.fn(),
    root: document.body,
  };
  renderView(section, record, host);
  return { section, host, record };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the table', () => {
  it('has Title, the property the query names and Updated as columns, one row per note', () => {
    const { section } = make();
    expect(Array.from(section.querySelectorAll('.view-th')).map((th) => th.textContent)).toEqual(['Title', 'status', 'Updated']);
    const rows = section.querySelectorAll('.view-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.view-title')?.textContent).toBe('Alpha');
    expect(rows[0].querySelector('.col-prop')?.textContent).toBe('draft');
    expect(section.querySelector('.view-count')?.textContent).toBe('3 notes');
    expect(section.querySelector('.view-hint')?.textContent).toContain('Not undoable');
  });

  it('opens a note from its title, keeping the view where it is', () => {
    const { section, host } = make();
    section.querySelectorAll<HTMLButtonElement>('.view-title')[1].click();
    expect(host.open).toHaveBeenCalledWith('b');
  });

  it('sorts on a header click and offers Query order once sorted', () => {
    const { section, host, record } = make();
    section.querySelectorAll<HTMLButtonElement>('.view-sort-btn')[1].click();
    expect(host.update).toHaveBeenCalledWith(record, expect.objectContaining({ sortBy: 'prop:status' }));
    const sorted = make({ sortBy: 'prop:rating', sortDir: 'desc', columns: ['title', 'prop:rating'] });
    expect(Array.from(sorted.section.querySelectorAll('.view-row .view-title')).map((t) => t.textContent)).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(sorted.section.querySelector('.view-sort')?.textContent).toBe('Sorted by rating ↓');
    const clear = Array.from(sorted.section.querySelectorAll<HTMLButtonElement>('.view-ctl')).find((b) => b.textContent === 'Query order');
    clear?.click();
    expect(sorted.host.update).toHaveBeenCalledWith(sorted.record, expect.not.objectContaining({ sortBy: expect.anything() }));
  });

  it('groups under a heading row per value, with the count, No value last', () => {
    const { section } = make({ groupBy: 'prop:rating', columns: ['title', 'prop:rating'] });
    expect(Array.from(section.querySelectorAll('.view-group-head')).map((h) => h.textContent)).toEqual(['3 · 1', '9 · 1', 'No value · 1']);
  });

  it('edits a text cell in place and commits through the store on Enter, nothing on Escape', async () => {
    const { section, host } = make();
    const cell = section.querySelectorAll<HTMLElement>('.view-row')[0].querySelector<HTMLElement>('.col-prop')!;
    cell.click();
    const input = cell.querySelector<HTMLInputElement>('input.view-edit');
    expect(input?.value).toBe('draft');
    input!.value = 'review';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(host.setProperty).toHaveBeenCalledWith('a', { key: 'status', value: 'review' });
    const other = section.querySelectorAll<HTMLElement>('.view-row')[1].querySelector<HTMLElement>('.col-prop')!;
    other.click();
    const second = other.querySelector<HTMLInputElement>('input');
    second!.value = 'x';
    second!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.setProperty).toHaveBeenCalledTimes(1);
    expect(other.querySelector('input')).toBeNull();
  });

  it('removes a property when the cell is emptied, and refuses a mapping without closing', async () => {
    const { section, host } = make();
    const cell = section.querySelectorAll<HTMLElement>('.view-row')[0].querySelector<HTMLElement>('.col-prop')!;
    cell.click();
    const input = cell.querySelector<HTMLInputElement>('input')!;
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(host.setProperty).toHaveBeenCalledWith('a', { key: 'status' });
    const bad = make();
    const c2 = bad.section.querySelectorAll<HTMLElement>('.view-row')[0].querySelector<HTMLElement>('.col-prop')!;
    c2.click();
    const i2 = c2.querySelector<HTMLInputElement>('input')!;
    i2.value = '{a: 1}';
    i2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(bad.host.setProperty).not.toHaveBeenCalled();
    expect(bad.host.status).toHaveBeenCalled();
    expect(c2.querySelector('input')).not.toBeNull();
  });

  it('ticks a boolean with a checkbox and types a number into a number field', () => {
    const { section, host } = make({ columns: ['title', 'prop:done', 'prop:rating'] });
    const row = section.querySelectorAll<HTMLElement>('.view-row')[0];
    const box = row.querySelector<HTMLInputElement>('input.view-check')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(host.setProperty).toHaveBeenCalledWith('a', { key: 'done', value: true });
    const num = row.querySelectorAll<HTMLElement>('.col-prop')[1];
    num.click();
    expect(num.querySelector<HTMLInputElement>('input')?.type).toBe('number');
  });
});

describe('cards', () => {
  it('draws a card per note with its first properties and a line of the body, read-only', () => {
    const { section } = make({ layout: 'cards', columns: ['title', 'prop:status', 'prop:rating', 'updated'] });
    const cards = Array.from(section.querySelectorAll('.view-card'));
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.view-card-title')?.textContent).toBe('Alpha');
    expect(Array.from(cards[0].querySelectorAll('.view-card-key')).map((k) => k.textContent)).toEqual(['status', 'rating']);
    expect(cards[0].querySelector('.view-card-line')?.textContent).toBe('Alpha');
    expect(section.querySelector('input')).toBeNull();
    expect(section.querySelector('.view-hint')).toBeNull();
  });
});

describe('the bar', () => {
  it('opens the layout picker, the group picker and the columns sheet', () => {
    const { section, host } = make();
    const ctls = Array.from(section.querySelectorAll<HTMLButtonElement>('.view-ctl'));
    ctls.find((b) => b.textContent === 'Layout')?.click();
    expect(host.pickLayout).toHaveBeenCalled();
    ctls.find((b) => b.textContent === 'Group by…')?.click();
    expect(host.pick).toHaveBeenCalled();
    ctls.find((b) => b.textContent === 'Columns…')?.click();
    const sheet = document.querySelector('.columns-card');
    expect(sheet).not.toBeNull();
    const rows = Array.from(sheet!.querySelectorAll('.columns-row'));
    expect(rows.map((r) => r.querySelector('.columns-name')?.textContent)).toEqual(['Title', 'status', 'Updated', 'rating', 'done', 'owner']);
    // Title cannot go.
    expect(rows[0].querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    // Ticking rating adds it to the columns.
    const rating = rows[3].querySelector<HTMLInputElement>('input')!;
    rating.checked = true;
    rating.dispatchEvent(new Event('change'));
    expect(host.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ columns: ['title', 'prop:status', 'updated', 'prop:rating'] }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.columns-card')).toBeNull();
  });
});
