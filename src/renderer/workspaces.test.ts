import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspacesUi, type WorkspacesHost } from './workspaces-ui';
import { cleanName, parseWorkspaces, resolveWorkspace, sameArrangement, withWorkspace, type PaneSnapshot, type Workspace } from './workspaces';
import { place, caretBox } from './anchored';

const pane = (tabs: string[], activeId: string | null = tabs[0] ?? null, preview = false): PaneSnapshot => ({ tabs, activeId, preview });

const workspace = (name: string, panes: PaneSnapshot[], id = name.toLowerCase()): Workspace => ({
  id,
  name,
  panes,
  paneAt: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

describe('parseWorkspaces', () => {
  it('drops anything malformed rather than throwing it all away', () => {
    const held = parseWorkspaces([
      workspace('Release', [pane(['a', 'b'])]),
      { id: 'x', name: '   ', panes: [pane(['a'])] },
      { id: '', name: 'No id', panes: [pane(['a'])] },
      { id: 'y', name: 'No panes', panes: [] },
      'nonsense',
      null,
    ]);
    expect(held.map((w) => w.name)).toEqual(['Release']);
    expect(parseWorkspaces('not a list')).toEqual([]);
  });

  it('keeps the first of two sharing a name, whatever their case', () => {
    const held = parseWorkspaces([workspace('Release', [pane(['a'])], '1'), workspace('release', [pane(['b'])], '2')]);
    expect(held.map((w) => w.id)).toEqual(['1']);
  });

  it('trims a name and cuts a long one', () => {
    expect(cleanName('  Release   notes  ')).toBe('Release notes');
    expect(cleanName('x'.repeat(200)).length).toBe(80);
  });

  it('brings paneAt back inside the panes it has', () => {
    expect(parseWorkspaces([{ ...workspace('R', [pane(['a'])]), paneAt: 9 }])[0].paneAt).toBe(0);
  });
});

describe('resolveWorkspace', () => {
  const has = (id: string): boolean => ['a', 'b', 'c'].includes(id);

  it('opens what is there and leaves out what is not', () => {
    const w = workspace('Release', [pane(['a', 'gone', 'b']), pane(['c'])]);
    const out = resolveWorkspace(w, has);
    expect(out.panes.map((p) => p.tabs)).toEqual([['a', 'b'], ['c']]);
    expect(out.missing).toBe(1);
  });

  it('never refuses the whole arrangement because a note was trashed', () => {
    const w = workspace('Release', [pane(['gone']), pane(['a'])]);
    const out = resolveWorkspace(w, has);
    // The empty pane stays a pane: the arrangement is what was saved.
    expect(out.panes.map((p) => p.tabs)).toEqual([[], ['a']]);
    expect(out.missing).toBe(1);
  });

  it('falls back to one empty pane when nothing at all survives', () => {
    const out = resolveWorkspace(workspace('Old', [pane(['gone']), pane(['also-gone'])]), has);
    expect(out.panes).toEqual([{ tabs: [], activeId: null, preview: false }]);
    expect(out.paneAt).toBe(0);
    expect(out.missing).toBe(2);
  });

  it('picks another tab when the one that was showing has gone', () => {
    const out = resolveWorkspace(workspace('R', [pane(['a', 'b'], 'gone')]), has);
    expect(out.panes[0].activeId).toBe('a');
  });

  it('keeps each pane’s preview, which is part of the arrangement', () => {
    const out = resolveWorkspace(workspace('R', [pane(['a'], 'a', true), pane(['b'])]), has);
    expect(out.panes.map((p) => p.preview)).toEqual([true, false]);
  });

  it('clamps paneAt to a pane that survived', () => {
    const w = { ...workspace('R', [pane(['gone']), pane(['a'])]), paneAt: 1 };
    expect(resolveWorkspace(w, has).paneAt).toBe(1);
    const one = { ...workspace('R', [pane(['gone'])]), paneAt: 0 };
    expect(resolveWorkspace(one, has).paneAt).toBe(0);
  });
});

describe('withWorkspace and sameArrangement', () => {
  it('replaces the one sharing a name, keeping its id and when it was made', () => {
    const held = [workspace('Release', [pane(['a'])], 'one')];
    const next = withWorkspace(held, { ...workspace('release', [pane(['b'])], 'two'), createdAt: 'later' });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'one', name: 'release', createdAt: '2026-09-01T00:00:00.000Z' });
    expect(next[0].panes[0].tabs).toEqual(['b']);
  });

  it('appends one with a name nobody has', () => {
    expect(withWorkspace([workspace('Release', [pane(['a'])])], workspace('Writing', [pane(['b'])])).map((w) => w.name)).toEqual(['Release', 'Writing']);
  });

  it('knows when what is open is no longer what was saved', () => {
    expect(sameArrangement([pane(['a', 'b'])], [pane(['a', 'b'])])).toBe(true);
    expect(sameArrangement([pane(['a', 'b'])], [pane(['a'])])).toBe(false);
    expect(sameArrangement([pane(['a'], 'a', true)], [pane(['a'])])).toBe(false);
    expect(sameArrangement([pane(['a'])], [pane(['a']), pane(['b'])])).toBe(false);
  });
});

describe('placing a floating thing', () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 200, height: 100 };

  it('prefers the right, then the left, then below, then above', () => {
    expect(place({ left: 100, top: 100, right: 200, bottom: 120 }, size, view).side).toBe('right');
    // No room on the right: it goes left.
    expect(place({ left: 700, top: 100, right: 900, bottom: 120 }, size, view).side).toBe('left');
    // No room either side: below.
    expect(place({ left: 100, top: 100, right: 900, bottom: 120 }, size, view).side).toBe('below');
    // And above when there is no room under it.
    expect(place({ left: 100, top: 600, right: 900, bottom: 780 }, size, view).side).toBe('above');
  });

  it('never leaves the window, even where nothing fits', () => {
    const at = place({ left: 0, top: 0, right: 1000, bottom: 800 }, size, view);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.left + size.width).toBeLessThanOrEqual(view.width);
    expect(at.top + size.height).toBeLessThanOrEqual(view.height);
  });

  it('measures a caret with no height by the line it is on', () => {
    const range = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect,
      getClientRects: () => [{ left: 40, top: 60, right: 40, bottom: 78 }] as unknown as DOMRectList,
    } as unknown as Range;
    expect(caretBox(range)).toEqual({ left: 40, top: 60, right: 40, bottom: 78 });
  });
});

describe('the workspaces sheet', () => {
  let held: Workspace[];
  let loaded: string | null;
  const calls: string[] = [];

  function harness(): { host: WorkspacesHost; ui: ReturnType<typeof createWorkspacesUi> } {
    document.body.innerHTML = '';
    held = [workspace('Release', [pane(['a', 'b'])], 'one')];
    loaded = null;
    calls.length = 0;
    const host: WorkspacesHost = {
      held: () => held,
      current: () => ({ panes: [pane(['a'])], paneAt: 0 }),
      loadedId: () => loaded,
      save: (name) => {
        calls.push(`save ${name}`);
        held = [...held, workspace(name, [pane(['a'])], name)];
      },
      update: (id) => calls.push(`update ${id}`),
      load: (id) => calls.push(`load ${id}`),
      rename: (id, name) => calls.push(`rename ${id} ${name}`),
      remove: (id) => {
        calls.push(`remove ${id}`);
        held = held.filter((w) => w.id !== id);
      },
      status: vi.fn(),
      focusEditor: vi.fn(),
      titleOf: (id) => (id === 'a' ? 'The plan' : id === 'b' ? 'The tests' : null),
      root: document.body,
    };
    return { host, ui: createWorkspacesUi(host) };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lists what is saved, and what each one holds', () => {
    const h = harness();
    h.ui.open();
    expect([...document.querySelectorAll('.ws-name')].map((e) => e.textContent)).toEqual(['Release']);
    expect(document.querySelector('.ws-what')?.textContent).toBe('1 pane · The plan, The tests');
  });

  it('opens one by clicking it, and closes', () => {
    const h = harness();
    h.ui.open();
    document.querySelector<HTMLButtonElement>('.ws-name')!.click();
    expect(calls).toEqual(['load one']);
    expect(h.ui.isOpen()).toBe(false);
  });

  it('saves what is open under a typed name', () => {
    const h = harness();
    h.ui.open();
    const box = document.querySelector<HTMLInputElement>('.ws-new')!;
    box.value = ' Writing ';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual(['save Writing']);
  });

  it('offers to replace a name already taken rather than taking it', () => {
    const h = harness();
    h.ui.open();
    const box = document.querySelector<HTMLInputElement>('.ws-new')!;
    box.value = 'release';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual([]);
    expect(h.host.status).toHaveBeenCalledWith(expect.stringContaining('already exists'), expect.any(Number));
    // Saying it again is the confirmation.
    document.querySelector<HTMLInputElement>('.ws-new')!.value = 'release';
    document.querySelector<HTMLInputElement>('.ws-new')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual(['save release']);
  });

  it('asks once before deleting, because a snapshot does not come back', () => {
    const h = harness();
    h.ui.open();
    const remove = (): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.ws-act')].find((b) => b.textContent?.startsWith('Delete'))!;
    remove().click();
    expect(calls).toEqual([]);
    expect(remove().textContent).toBe('Delete — click again');
    remove().click();
    expect(calls).toEqual(['remove one']);
  });

  it('renames on Enter', () => {
    const h = harness();
    h.ui.open();
    [...document.querySelectorAll<HTMLButtonElement>('.ws-act')].find((b) => b.textContent === 'Rename')!.click();
    const box = document.querySelector<HTMLInputElement>('.ws-rename')!;
    box.value = 'Shipping';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual(['rename one Shipping']);
  });

  it('offers to update the loaded one only when what is open has moved on', () => {
    const h = harness();
    loaded = null;
    h.ui.open();
    expect(document.querySelector('.ws-update')).toBe(null);
    h.ui.close();
    loaded = 'one';
    h.ui.open();
    // Saved with two tabs, one open now: a snapshot never updates itself.
    expect(document.querySelector('.ws-update')?.textContent).toContain('Update “Release”');
    document.querySelector<HTMLButtonElement>('.ws-update')!.click();
    expect(calls).toEqual(['update one']);
  });
});
