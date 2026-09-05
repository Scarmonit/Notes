import { beforeEach, describe, expect, it } from 'vitest';
import type { Plan } from '../core/refactor';
import type { Note } from '../shared/types';
import { createRefactorUi, type PickChoice, type PickOptions, type RefactorHostUi, type RefactorUi } from './refactor-ui';

const note = (id: string, body: string, title?: string): Note => (title === undefined ? { id, body, createdAt: 1, updatedAt: id.charCodeAt(0) } : { id, body, title, createdAt: 1, updatedAt: id.charCodeAt(0) });

/** A host whose picker is a recording: the test reads the rows and chooses one. */
function fakeHost(initial: Note[], selectedId: string, initialSelection: { first: number; last: number } | null) {
  let notes = initial;
  let selection = initialSelection;
  const picks: Array<{ placeholder: string; items: PickChoice[]; options: PickOptions; onClose?: () => void }> = [];
  const applied: Plan[] = [];
  const statuses: string[] = [];
  let focused = 0;
  let failNext: string | null = null;
  const host: RefactorHostUi = {
    notes: () => notes,
    selected: () => notes.find((n) => n.id === selectedId) ?? null,
    selection: () => selection,
    pick: (placeholder, items, options = {}, onClose) => {
      picks.push({ placeholder, items, options, onClose });
    },
    apply: async (plan) => {
      if (failNext) {
        const message = failNext;
        failNext = null;
        return { ok: false, message };
      }
      applied.push(plan);
      const gone = new Set(plan.trash.map((t) => t.id));
      notes = notes
        .filter((n) => !gone.has(n.id))
        .map((n) => {
          const w = plan.writes.find((x) => x.id === n.id);
          if (!w) return n;
          const { title: _t, ...rest } = n;
          return w.after.title !== undefined ? { ...rest, title: w.after.title, body: w.after.body } : { ...rest, body: w.after.body };
        });
      return { ok: true };
    },
    status: (text) => {
      statuses.push(text);
    },
    focusEditor: () => {
      focused++;
    },
    root: document.body,
  };
  return {
    host,
    picks,
    applied,
    statuses,
    get focused() {
      return focused;
    },
    get notes() {
      return notes;
    },
    failNext: (m: string) => {
      failNext = m;
    },
    select: (sel: { first: number; last: number } | null) => {
      selection = sel;
    },
    last: () => picks[picks.length - 1],
    choose: (label: string) => {
      const p = picks[picks.length - 1];
      const item = p.items.find((it) => it.label.trim() === label);
      if (!item) throw new Error(`no row "${label}" among ${p.items.map((it) => it.label).join(' | ')}`);
      item.run();
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const key = (target: Element, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('move lines', () => {
  const inbox = note('in', 'call the bank\n\n- [ ] milk\n- [ ] eggs', 'Inbox');
  const project = note('pr', '# Project\n\n## Ideas\n\n- old\n\n## Done');

  it('walks note picker then heading picker, applies, reports, and remembers the destination', async () => {
    const h = fakeHost([inbox, project], 'in', { first: 2, last: 3 });
    const ui = createRefactorUi(h.host);
    ui.moveLines();
    expect(h.last().placeholder).toBe('Move 2 lines to which note?');
    expect(h.last().items.map((it) => it.label)).toEqual(['Project', 'Inbox']);
    expect(h.last().options.at).toBe(0);
    h.choose('Project');
    expect(h.last().placeholder).toBe('Move 2 lines under which heading?');
    expect(h.last().items.map((it) => [it.label.trim(), it.disabled === true])).toEqual([
      ["In 'Project'", true],
      ['Top of the note', false],
      ['End of the note', false],
      ['Project', false],
      ['Ideas', false],
      ['Done', false],
    ]);
    expect(h.last().options.at).toBe(1);
    h.choose('Ideas');
    await flush();
    expect(h.applied).toHaveLength(1);
    expect(h.notes.find((n) => n.id === 'pr')?.body).toBe('# Project\n\n## Ideas\n\n- old\n\n- [ ] milk\n- [ ] eggs\n\n## Done');
    expect(h.statuses).toEqual(["Moved 2 lines to 'Project' › 'Ideas'"]);
    expect(h.focused).toBe(1);
    expect(ui.lastMove()).toEqual({ noteId: 'pr', target: { line: 2 } });

    // Next time both pickers start on what was chosen.
    h.select({ first: 0, last: 0 });
    ui.moveLines();
    expect(h.last().options.at).toBe(0);
    h.choose('Project');
    expect(h.last().options.at).toBe(4);
  });

  it('offers to create a heading from what is typed', async () => {
    const h = fakeHost([inbox, project], 'in', { first: 0, last: 0 });
    const ui = createRefactorUi(h.host);
    ui.moveLines();
    h.choose('Project');
    const typed = h.last().options.typed?.('Calls');
    expect(typed?.label).toBe("Create 'Calls' at the end");
    typed?.run();
    await flush();
    expect(h.notes.find((n) => n.id === 'pr')?.body).toBe(`${project.body}\n\n## Calls\n\ncall the bank`);
    expect(h.statuses).toEqual(["Moved 1 line to 'Project' › 'Calls'"]);
    expect(ui.lastMove()).toEqual({ noteId: 'pr', target: 'end', createHeading: 'Calls' });
  });

  it('disables headings inside the moved range of the same note', () => {
    const one = note('a', '# A\n\n- x\n\n# B\n\n- y');
    const h = fakeHost([one], 'a', { first: 0, last: 2 });
    createRefactorUi(h.host).moveLines();
    h.choose('A');
    const rows = h.last().items;
    expect(rows.find((it) => it.label.trim() === 'A')?.disabled).toBe(true);
    expect(rows.find((it) => it.label.trim() === 'B')?.disabled).toBe(false);
  });

  it('says so when there is nothing to move, and returns focus on cancel', () => {
    const h = fakeHost([inbox], 'in', null);
    createRefactorUi(h.host).moveLines();
    expect(h.statuses).toEqual(['Put the caret on the line to move, or select some lines']);
    const blank = fakeHost([note('b', 'a\n\nb')], 'b', { first: 1, last: 1 });
    createRefactorUi(blank.host).moveLines();
    expect(blank.statuses).toEqual(['Nothing to move: the line is blank']);
    const h2 = fakeHost([inbox, project], 'in', { first: 0, last: 0 });
    createRefactorUi(h2.host).moveLines();
    h2.last().onClose?.();
    expect(h2.focused).toBe(1);
  });

  it('shows the failure on the status line when applying fails', async () => {
    const h = fakeHost([inbox, project], 'in', { first: 0, last: 0 });
    h.failNext("'Project' changed meanwhile; look again and retry");
    createRefactorUi(h.host).moveLines();
    h.choose('Project');
    h.choose('End of the note');
    await flush();
    expect(h.statuses).toEqual(["'Project' changed meanwhile; look again and retry"]);
    expect(h.applied).toEqual([]);
  });
});

describe('move section', () => {
  it('moves the section around the caret, and refuses a caret above the first heading', async () => {
    const a = note('a', 'intro\n\n# One\n\ntext\n\n# Two\n\nmore');
    const b = note('b', '# B');
    const h = fakeHost([a, b], 'a', { first: 4, last: 4 });
    createRefactorUi(h.host).moveSection();
    expect(h.last().placeholder).toBe("Move the section 'One' to which note?");
    h.choose('B');
    h.choose('End of the note');
    await flush();
    expect(h.notes.map((n) => n.body)).toEqual(['intro\n\n# Two\n\nmore', '# B\n\n# One\n\ntext']);
    const above = fakeHost([a, b], 'a', { first: 0, last: 0 });
    createRefactorUi(above.host).moveSection();
    expect(above.statuses).toEqual(['Put the caret in a section first']);
  });
});

describe('rename a tag', () => {
  it('picks a tag, prompts for the name, confirms, applies', async () => {
    const h = fakeHost([note('a', 'x #old'), note('b', '#old/kid #other')], 'a', null);
    const ui = createRefactorUi(h.host);
    ui.renameTag();
    expect(h.last().items.map((it) => [it.label, it.hint])).toEqual([
      ['#old', '1 note'],
      ['#old/kid', '1 note'],
      ['#other', '1 note'],
    ]);
    h.choose('#old');
    const input = document.querySelector<HTMLInputElement>('.prompt-input')!;
    expect(document.querySelector('.prompt-label')?.textContent).toBe('Rename #old to');
    expect(input.value).toBe('old');
    expect(document.activeElement).toBe(input);
    input.value = 'new';
    key(input, 'Enter');
    await flush();
    expect(ui.isOpen()).toBe(true);
    const card = document.querySelector<HTMLElement>('.confirm-card')!;
    expect(document.querySelector('.confirm-text')?.textContent).toBe('Rename #old to #new in 2 notes (2 tags)?');
    expect(document.querySelector('.confirm-count')?.textContent).toBe('2 notes ›');
    expect(document.querySelector<HTMLElement>('.confirm-list')?.hidden).toBe(true);
    key(card, ' ');
    expect(document.querySelector<HTMLElement>('.confirm-list')?.hidden).toBe(false);
    const rows = [...document.querySelectorAll('.confirm-row')].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('x #oldtags rewritten');
    expect(rows.every((r) => r.endsWith('tags rewritten'))).toBe(true);
    key(card, 'Enter');
    await flush();
    expect(ui.isOpen()).toBe(false);
    expect(h.notes.map((n) => n.body)).toEqual(['x #new', '#new/kid #other']);
    expect(h.statuses).toEqual(['Renamed #old to #new in 2 notes']);
    expect(h.focused).toBe(1);
  });

  it('cancels from the prompt and from the confirm sheet, returning focus each time', async () => {
    const h = fakeHost([note('a', 'x #old')], 'a', null);
    const ui = createRefactorUi(h.host);
    ui.renameTag();
    h.choose('#old');
    key(document.querySelector('.prompt-input')!, 'Escape');
    await flush();
    expect(h.focused).toBe(1);
    expect(h.applied).toEqual([]);
    ui.renameTag();
    h.choose('#old');
    const input = document.querySelector<HTMLInputElement>('.prompt-input')!;
    input.value = 'fresh';
    key(input, 'Enter');
    await flush();
    key(document.querySelector('.confirm-card')!, 'Escape');
    await flush();
    expect(h.focused).toBe(2);
    expect(h.applied).toEqual([]);
    expect(h.notes[0].body).toBe('x #old');
  });

  it('refuses a bad name on the status line', async () => {
    const h = fakeHost([note('a', 'x #old')], 'a', null);
    createRefactorUi(h.host).renameTag();
    h.choose('#old');
    const input = document.querySelector<HTMLInputElement>('.prompt-input')!;
    input.value = 'two words';
    key(input, 'Enter');
    await flush();
    expect(h.statuses[0]).toContain('is not a tag');
  });
});

describe('merge into', () => {
  it('lists the other notes, confirms, and merges', async () => {
    const h = fakeHost([note('s', 'dup', 'Dup'), note('t', 'keep', 'Plan'), note('o', '[[Dup]]')], 's', null);
    const ui = createRefactorUi(h.host);
    ui.mergeInto(h.host.selected());
    expect(h.last().placeholder).toBe("Merge 'Dup' into which note?");
    expect(h.last().items.map((it) => it.label)).toEqual(['Plan', 'Dup']);
    h.choose('Plan');
    expect(document.querySelector('.confirm-text')?.textContent).toBe("Merge 'Dup' into 'Plan', updating 1 link in 1 note, and move 'Dup' to the trash?");
    key(document.querySelector('.confirm-card')!, 'Enter');
    await flush();
    expect(h.notes.map((n) => [n.id, n.body])).toEqual([
      ['t', 'keep\n\n## Dup\n\ndup'],
      ['o', '[[Plan]]'],
    ]);
    expect(h.statuses[0]).toContain("Merged 'Dup' into 'Plan'");
    expect(ui.isOpen()).toBe(false);
  });

  // Reached from the right-click menu, the source is the row that was clicked.
  // Taking it from the selection instead merged — and trashed — the note on
  // screen, which is not the note that was asked about.
  it('merges the note it was handed, not the one on screen', async () => {
    const h = fakeHost([note('s', 'reading', 'Reading'), note('c', 'dup', 'Clicked'), note('t', 'keep', 'Plan')], 's', null);
    const ui = createRefactorUi(h.host);
    ui.mergeInto(h.notes.find((n) => n.id === 'c') ?? null);
    expect(h.last().placeholder).toBe("Merge 'Clicked' into which note?");
    // The note on screen is a destination like any other; the clicked one is not.
    expect(h.last().items.map((it) => it.label)).toEqual(['Plan', 'Reading']);
    h.choose('Plan');
    key(document.querySelector('.confirm-card')!, 'Enter');
    await flush();
    expect(h.notes.map((n) => n.id).sort()).toEqual(['s', 't']);
    expect(h.notes.find((n) => n.id === 't')?.body).toBe('keep\n\n## Clicked\n\ndup');
    expect(h.statuses[0]).toContain("Merged 'Clicked' into 'Plan'");
  });
});

describe('commitRename', () => {
  it('applies the title alone when nothing links to the old name', async () => {
    const h = fakeHost([note('a', 'x', 'Old'), note('b', 'none')], 'a', null);
    const ui = createRefactorUi(h.host);
    expect(await ui.commitRename('a', 'Old', 'New')).toBe('title');
    expect(h.notes[0].title).toBe('New');
    expect(ui.isOpen()).toBe(false);
  });

  it('asks about links: Enter updates them, Esc keeps them, either way the title changes', async () => {
    const h = fakeHost([note('a', 'x', 'Old'), note('b', 'see [[old]]')], 'a', null);
    const ui = createRefactorUi(h.host);
    let done = ui.commitRename('a', 'Old', 'New');
    await flush();
    expect(document.querySelector('.confirm-text')?.textContent).toBe("Rename 'Old' to 'New' and update 1 link in 1 note?");
    expect(document.querySelector('.sheet-foot')?.textContent).toBe('Enter updates the links · Space shows the notes · Esc keeps them as they are');
    key(document.querySelector('.confirm-card')!, 'Enter');
    expect(await done).toBe('links');
    expect(h.notes.map((n) => n.body)).toEqual(['x', 'see [[New]]']);
    expect(h.notes[0].title).toBe('New');

    done = ui.commitRename('a', 'New', 'Newer');
    await flush();
    key(document.querySelector('.confirm-card')!, 'Escape');
    expect(await done).toBe('title');
    expect(h.notes[1].body).toBe('see [[New]]');
    expect(h.notes[0].title).toBe('Newer');
  });

  it('builds the Plan against the title as it was at focus, even when the note had none', async () => {
    const h = fakeHost([note('a', '# Draft\n\nwords'), note('b', '[[draft]]')], 'a', null);
    const ui = createRefactorUi(h.host);
    const done = ui.commitRename('a', undefined, 'Final');
    await flush();
    key(document.querySelector('.confirm-card')!, 'Enter');
    expect(await done).toBe('links');
    expect(h.applied[0].writes[0].before).toEqual({ body: '# Draft\n\nwords' });
    expect(h.notes[1].body).toBe('[[Final]]');
  });

  it('answers none for an unchanged title and failed when applying fails', async () => {
    const h = fakeHost([note('a', 'x', 'Old')], 'a', null);
    const ui = createRefactorUi(h.host);
    expect(await ui.commitRename('a', 'Old', 'Old')).toBe('none');
    h.failNext('nope');
    expect(await ui.commitRename('a', 'Old', 'New')).toBe('failed');
    expect(h.statuses).toEqual(['nope']);
  });
});

describe('dismiss', () => {
  it('closes whichever sheet is open as a cancel', async () => {
    const h = fakeHost([note('a', 'x', 'Old'), note('b', '[[Old]]')], 'a', null);
    const ui: RefactorUi = createRefactorUi(h.host);
    const done = ui.commitRename('a', 'Old', 'New');
    await flush();
    expect(ui.isOpen()).toBe(true);
    ui.dismiss();
    expect(await done).toBe('title');
    expect(ui.isOpen()).toBe(false);
  });
});

describe('one sheet at a time', () => {
  it('answers a waiting confirm "no" when another question takes the sheet, so no caller waits forever', async () => {
    const h = fakeHost([note('a', 'x', 'Old'), note('b', 'see [[old]]'), note('t', 'keep', 'Plan')], 'a', null);
    const ui = createRefactorUi(h.host);
    const rename = ui.commitRename('a', 'Old', 'New');
    await flush();
    expect(document.querySelector('.confirm-text')?.textContent).toBe("Rename 'Old' to 'New' and update 1 link in 1 note?");
    // A merge started meanwhile asks its own question on the same sheet.
    ui.mergeInto(h.host.selected());
    h.choose('Plan');
    expect(document.querySelector('.confirm-text')?.textContent).toContain("Merge 'Old' into 'Plan'");
    expect(await rename).toBe('title');
    key(document.querySelector('.confirm-card')!, 'Escape');
    await flush();
    expect(ui.isOpen()).toBe(false);
  });
});
