import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFootnotesRail, mapOffset, nearestRef, offsetOfLineCol, type FocusState, type FootnotesHost } from './footnotes-ui';

const BODY = 'One[^a] and two[^b] and one again[^a] and in^[line words].\n\n[^a]: The first.\n[^b]: The second,\n    over two lines.\n[^lonely]: nobody\n\nsee [^gone]';

function make(overrides: Partial<FootnotesHost> = {}, body = BODY) {
  const root = document.createElement('section');
  document.body.append(root);
  let text = body;
  const host: FootnotesHost = {
    body: () => text,
    preview: () => false,
    enabled: () => true,
    pageShown: () => true,
    capture: () => ({ anchor: 3, focus: 3, scrollTop: 40 }),
    restore: vi.fn<(s: FocusState) => void>(),
    goTo: vi.fn<(o: number) => void>(),
    scrollPreview: vi.fn(),
    setBody: vi.fn((next: string) => {
      text = next;
    }),
    status: vi.fn(),
    root,
    ...overrides,
  };
  const rail = createFootnotesRail(host);
  return { rail, host, root, text: () => text };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the rows', () => {
  it('lists the numbered footnotes, then the definition nobody refers to, then the id nobody defines', () => {
    const { rail, root } = make();
    expect(rail.render()).toBe(true);
    expect(root.hidden).toBe(false);
    const rows = Array.from(root.querySelectorAll('.fn-row'));
    expect(rows.map((r) => r.className)).toEqual(['fn-row fn-named', 'fn-row fn-named', 'fn-row fn-inline', 'fn-row fn-unreferenced', 'fn-row fn-undefined']);
    expect(rows.map((r) => r.querySelector('.fn-num')?.textContent ?? '')).toEqual(['1', '2', '3', '', '']);
    expect(rows[0].querySelector('.fn-id')?.textContent).toBe('[^a]');
    expect(rows[0].querySelector('.fn-text')?.textContent).toBe('The first.');
    expect(rows[1].querySelector('.fn-text')?.textContent).toBe('The second, over two lines.');
    expect(rows[2].querySelector('.fn-kind')?.textContent).toBe('Inline');
    expect(rows[3].querySelector('.fn-id')?.textContent).toBe('[^lonely]');
    expect(rows[4].querySelector('.fn-none')?.textContent).toBe('No definition');
    expect(rows[4].querySelector('.fn-create')).not.toBeNull();
  });

  it('is hidden with nothing to show, or when the rail is off', () => {
    const none = make({}, 'no footnotes here');
    expect(none.rail.render()).toBe(false);
    expect(none.root.hidden).toBe(true);
    const off = make({ enabled: () => false });
    expect(off.rail.render()).toBe(false);
  });
});

describe('going to a reference', () => {
  it('goes to the reference nearest the remembered caret, the one after it on a tie', () => {
    expect(nearestRef([10, 30], 20)).toBe(30);
    expect(nearestRef([10, 30], 12)).toBe(10);
    expect(nearestRef([10, 30], 100)).toBe(30);
    expect(offsetOfLineCol('ab\ncd\nef', 2, 1)).toBe(7);
  });

  it('remembers where the writer was the first time, and the number moves the caret', () => {
    const { rail, host, root } = make();
    rail.render();
    (root.querySelectorAll<HTMLButtonElement>('.fn-num')[0] as HTMLButtonElement).click();
    // Two references to [^a]: at 3 and at 33; the caret was at 3.
    expect(host.goTo).toHaveBeenCalledWith(3);
    expect(root.querySelector<HTMLElement>('.fn-back')?.hidden).toBe(false);
  });
});

describe('editing in place', () => {
  it('opens one editor, commits on Ctrl+Enter as a rewrite of the definition, and offers Back', () => {
    const { rail, host, root, text } = make();
    rail.render();
    const rows = root.querySelectorAll<HTMLElement>('.fn-row');
    rows[1].querySelector<HTMLButtonElement>('.fn-text')?.click();
    const area = rows[1].querySelector<HTMLTextAreaElement>('textarea.fn-edit');
    expect(area).not.toBeNull();
    expect(area?.value).toBe('The second,\nover two lines.');
    expect(rail.isEditing()).toBe(true);
    area!.value = 'Rewritten\n\nsecond paragraph';
    area!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(host.setBody).toHaveBeenCalledTimes(1);
    expect(text()).toContain('[^b]: Rewritten\n\n    second paragraph\n[^lonely]');
    expect(rail.isEditing()).toBe(false);
    // Back restores the place, mapped through the edit (the change was after the caret, so unmoved).
    root.querySelector<HTMLButtonElement>('.fn-back')?.click();
    expect(host.restore).toHaveBeenCalledWith({ anchor: 3, focus: 3, scrollTop: 40 });
  });

  it('cancels on Escape without writing, and an inline note edits its own words on one line', () => {
    const { rail, host, root, text } = make();
    rail.render();
    const rows = root.querySelectorAll<HTMLElement>('.fn-row');
    rows[0].querySelector<HTMLButtonElement>('.fn-text')?.click();
    const area = rows[0].querySelector<HTMLTextAreaElement>('textarea');
    area!.value = 'changed';
    area!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.setBody).not.toHaveBeenCalled();
    rail.render();
    const inlineRow = root.querySelectorAll<HTMLElement>('.fn-row')[2];
    inlineRow.querySelector<HTMLButtonElement>('.fn-text')?.click();
    const single = inlineRow.querySelector<HTMLTextAreaElement>('textarea');
    expect(single?.classList.contains('fn-edit-single')).toBe(true);
    single!.value = 'other words';
    single!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(text()).toContain('in^[other words].');
  });

  it('does not redraw under an open editor', () => {
    const { rail, root } = make();
    rail.render();
    root.querySelector<HTMLButtonElement>('.fn-text')?.click();
    const area = root.querySelector('textarea');
    rail.render();
    expect(root.querySelector('textarea')).toBe(area);
  });

  it('creates a missing definition at the end and opens its editor', () => {
    const { rail, root, text } = make();
    rail.render();
    root.querySelector<HTMLButtonElement>('.fn-create')?.click();
    expect(text().endsWith('\n\n[^gone]: ')).toBe(true);
    rail.render();
    expect(root.querySelector('textarea')).not.toBeNull();
  });
});

describe('in preview', () => {
  it('is read-only: the words scroll to the endnote, the number to a reference, and Create is disabled', () => {
    const { rail, host, root } = make({ preview: () => true });
    rail.render();
    const rows = root.querySelectorAll<HTMLElement>('.fn-row');
    rows[0].querySelector<HTMLButtonElement>('.fn-text')?.click();
    expect(host.scrollPreview).toHaveBeenCalledWith('.footnotes-list li:nth-child(1)');
    rows[0].querySelector<HTMLButtonElement>('.fn-num')?.click();
    expect(host.scrollPreview).toHaveBeenCalledWith('.footnote-ref a[data-footnote="1"]');
    expect(root.querySelector('textarea')).toBeNull();
    expect(rows[4].querySelector<HTMLButtonElement>('.fn-create')?.disabled).toBe(true);
    rows[3].querySelector<HTMLButtonElement>('.fn-id-btn')?.click();
    expect(host.scrollPreview).toHaveBeenCalledWith(null, '[^lonely]:');
  });
});

describe('mapOffset', () => {
  it('leaves an offset before a change alone and moves one after it by the difference', () => {
    expect(mapOffset('abc\ndef', 'abc\nDEFG', 2)).toBe(2);
    expect(mapOffset('abc\ndef', 'abc\nDEFGH', 7)).toBe(9);
    expect(mapOffset('abcdef', 'abc', 5)).toBe(3);
  });
});
