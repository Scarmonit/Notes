import { describe, expect, it } from 'vitest';
import { keyMap, matchActions, menuModel, pillActions, type Action } from './actions';

const noop = (): void => undefined;

const act = (id: string, label: string, extra: Partial<Action> = {}): Action => ({
  id,
  label,
  group: 'Notes',
  run: noop,
  ...extra,
});

const ACTIONS: Action[] = [
  act('new', 'New note', { chord: 'ctrl+n' }),
  act('find', 'Find a note', { chord: 'ctrl+k', also: ['ctrl+f'], terms: 'search' }),
  act('preview', 'Markdown preview', { chord: 'ctrl+e', group: 'View' }),
  act('delete', 'Delete this note', { chord: 'ctrl+shift+d', enabled: () => false }),
];

const ids = (query: string): string[] => matchActions(ACTIONS, query).map((m) => m.action.id);

describe('matchActions', () => {
  it('keeps the registry order when nothing is typed', () => {
    expect(ids('')).toEqual(['new', 'find', 'preview']);
  });

  it('hides commands that cannot run right now', () => {
    expect(ids('delete')).toEqual([]);
  });

  it('matches letters in order, not just whole words', () => {
    expect(ids('mkpv')).toEqual(['preview']);
  });

  it('puts word beginnings first', () => {
    // "nn" begins both words of "New note" and only straddles the others.
    expect(ids('nn')[0]).toBe('new');
  });

  it('finds a command by an extra term without underlining anything', () => {
    const [match] = matchActions(ACTIONS, 'search');
    expect(match.action.id).toBe('find');
    expect(match.hits).toEqual([]);
  });

  it('reports which characters of the label matched, in order', () => {
    const [match] = matchActions(ACTIONS, 'note');
    const matched = match.hits.map((i) => match.action.label[i]).join('');
    expect(matched.toLowerCase()).toBe('note');
    expect([...match.hits]).toEqual([...match.hits].sort((a, b) => a - b));
  });

  it('returns nothing for a query no command contains', () => {
    expect(ids('zzz')).toEqual([]);
  });
});

describe('keyMap', () => {
  it('maps every chord a command answers to, alternates included', () => {
    const map = keyMap(ACTIONS);
    expect(map.get('ctrl+n')?.id).toBe('new');
    expect(map.get('ctrl+k')?.id).toBe('find');
    expect(map.get('ctrl+f')?.id).toBe('find');
  });

  it('keeps disabled commands, so their key is still theirs', () => {
    expect(keyMap(ACTIONS).get('ctrl+shift+d')?.id).toBe('delete');
  });

  it('gives a contested chord to whichever command claims it first', () => {
    const map = keyMap([act('a', 'A', { chord: 'ctrl+q' }), act('b', 'B', { chord: 'ctrl+q' })]);
    expect(map.get('ctrl+q')?.id).toBe('a');
  });
});

const MENU_ACTIONS: Action[] = [
  act('new', 'New note', { menuSection: 'Create' }),
  act('import', 'Import files…', { menuSection: 'Create' }),
  act('pin', 'Pin this note', { menuSection: 'This note' }),
  act('task', 'Checklist item', { group: 'Writing', menuSection: 'Insert', pill: { label: 'Task', priority: 4 } }),
  act('date', 'Insert the date', { group: 'Writing', menuSection: 'Insert', pill: { label: 'Date', priority: 3 } }),
  act('undo', 'Undo', { group: 'Writing', menuSection: 'Edit' }),
  act('preview', 'Markdown preview', { group: 'View' }),
  act('outline', 'Outline', { group: 'View' }),
  act('sidebar', 'Toggle the sidebar', { group: 'Window', menuSection: 'Workspace' }),
];

describe('menuModel', () => {
  it('gives one menu per group, in menu order, named for the one note in front of you', () => {
    expect(menuModel(MENU_ACTIONS).map((m) => m.name)).toEqual(['Note', 'Write', 'View', 'Window']);
  });

  it('puts every command in exactly one menu, and keeps them all', () => {
    const placed = menuModel(MENU_ACTIONS).flatMap((m) => m.sections.flatMap((s) => s.items.map((a) => a.id)));
    expect(placed.sort()).toEqual(MENU_ACTIONS.map((a) => a.id).sort());
  });

  it('groups the commands under the headings they declare, in registry order', () => {
    const note = menuModel(MENU_ACTIONS)[0];
    expect(note.sections.map((s) => s.name)).toEqual(['Create', 'This note']);
    expect(note.sections[0].items.map((a) => a.id)).toEqual(['new', 'import']);
  });

  it('draws a menu whose commands claim no heading as one list', () => {
    const view = menuModel(MENU_ACTIONS).find((m) => m.group === 'View');
    expect(view?.sections).toHaveLength(1);
    expect(view?.sections[0].name).toBeNull();
    expect(view?.sections[0].items.map((a) => a.id)).toEqual(['preview', 'outline']);
  });

  it('starts a fresh section when a heading comes round again, rather than merging them', () => {
    const split = [act('a', 'A', { menuSection: 'One' }), act('b', 'B', { menuSection: 'Two' }), act('c', 'C', { menuSection: 'One' })];
    expect(menuModel(split)[0].sections.map((s) => s.name)).toEqual(['One', 'Two', 'One']);
  });

  it('leaves a menu with no commands empty rather than inventing one', () => {
    expect(menuModel([])).toHaveLength(4);
    expect(menuModel([])[0].sections).toEqual([]);
  });
});

describe('pillActions', () => {
  it('returns only the commands with a button, the one that survives longest first', () => {
    expect(pillActions(MENU_ACTIONS).map((a) => a.id)).toEqual(['task', 'date']);
  });

  it('drops from the end as a pane narrows, so the lowest priority goes first', () => {
    const pills = pillActions(MENU_ACTIONS);
    expect(pills.slice(0, pills.length - 1).map((a) => a.id)).toEqual(['task']);
  });

  it('finds nothing to show when no command asks for a button', () => {
    expect(pillActions([act('a', 'A')])).toEqual([]);
  });
});
