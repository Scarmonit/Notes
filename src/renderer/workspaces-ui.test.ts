import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkspacesUi, type WorkspacesHost } from './workspaces-ui';
import type { Workspace } from './workspaces';

/**
 * The workspaces sheet, driven through its own buttons.
 *
 * What this is here for is the pair of confirmations it asks: the Delete
 * button that wants a second click, and the save box that offers to replace a
 * name already taken. They looked alike enough to have shared one variable,
 * which meant answering one of them silently answered the other.
 */

const workspace = (id: string, name: string): Workspace => ({
  id,
  name,
  panes: [{ activeId: null, tabs: [], preview: false }],
  paneAt: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function fakeHost(initial: Workspace[]) {
  let held = initial;
  const removed: string[] = [];
  const saved: string[] = [];
  const host: WorkspacesHost = {
    held: () => held,
    current: () => ({ panes: [{ activeId: null, tabs: [], preview: false }], paneAt: 0 }),
    loadedId: () => null,
    save: (name) => {
      saved.push(name);
      held = [...held, workspace(`new-${name}`, name)];
    },
    update: () => undefined,
    load: () => undefined,
    rename: () => undefined,
    remove: (id) => {
      removed.push(id);
      held = held.filter((w) => w.id !== id);
    },
    status: () => undefined,
    focusEditor: () => undefined,
    titleOf: () => null,
    root: document.body,
  };
  return { host, removed, saved };
}

/** The Delete button of the nth row, and what it currently says. */
const deleteButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.ws-act')).filter((b) => (b.textContent ?? '').startsWith('Delete'));

const saveBox = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.ws-new')!;

const enter = (el: HTMLElement): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('deleting a workspace', () => {
  it('asks once, and says so on the button', () => {
    const h = fakeHost([workspace('a', 'Reading')]);
    const ui = createWorkspacesUi(h.host);
    ui.open();
    deleteButtons()[0].click();
    expect(h.removed).toEqual([]);
    expect(deleteButtons()[0].textContent).toBe('Delete — click again');
    deleteButtons()[0].click();
    expect(h.removed).toEqual(['a']);
  });

  it('is not armed by the save box offering to replace that same workspace', () => {
    // One variable held both confirmations. Offering to replace a snapshot
    // armed that row's Delete without redrawing it, so the button still read
    // "Delete" and the very next click on it deleted the workspace outright.
    const h = fakeHost([workspace('a', 'Reading')]);
    const ui = createWorkspacesUi(h.host);
    ui.open();
    saveBox().value = 'Reading';
    enter(saveBox());
    expect(h.saved).toEqual([]);
    expect(deleteButtons()[0].textContent).toBe('Delete');
    // The button still has its own question to ask.
    deleteButtons()[0].click();
    expect(h.removed).toEqual([]);
    expect(deleteButtons()[0].textContent).toBe('Delete — click again');
  });

  it('does not let an armed Delete answer the save box either', () => {
    const h = fakeHost([workspace('a', 'Reading')]);
    const ui = createWorkspacesUi(h.host);
    ui.open();
    deleteButtons()[0].click();
    saveBox().value = 'Reading';
    enter(saveBox());
    // The first Enter is the question, not the answer.
    expect(h.saved).toEqual([]);
    enter(saveBox());
    expect(h.saved).toEqual(['Reading']);
  });

  it('still replaces a snapshot when the offer is taken', () => {
    const h = fakeHost([workspace('a', 'Reading')]);
    const ui = createWorkspacesUi(h.host);
    ui.open();
    saveBox().value = 'Reading';
    enter(saveBox());
    enter(saveBox());
    expect(h.saved).toEqual(['Reading']);
    expect(h.removed).toEqual([]);
  });

  it('saves a name nothing else holds without asking at all', () => {
    const h = fakeHost([workspace('a', 'Reading')]);
    const ui = createWorkspacesUi(h.host);
    ui.open();
    saveBox().value = 'Writing';
    enter(saveBox());
    expect(h.saved).toEqual(['Writing']);
  });
});
