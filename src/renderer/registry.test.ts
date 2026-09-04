/**
 * The registry itself, read out of the source.
 *
 * `ACTIONS` lives in main.ts, where every command closes over the renderer it
 * drives, so it cannot be imported into a test. But it is the one list the
 * keyboard map, the shortcuts sheet, the palette and the pane's menus are all
 * built from, and a command that quietly declares no menu section falls out of
 * the menus without anything failing. So the source is read and checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Entry {
  id: string;
  label: string;
  group: string;
  menuSection: string | null;
  pill: { label: string; priority: number } | null;
  chord: string | null;
}

function registry(): Entry[] {
  const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
  const start = source.indexOf('const ACTIONS: Action[] = [');
  const end = source.indexOf('\n];', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const entries: Entry[] = [];
  // Each command starts at a brace two spaces in; everything until the next one
  // belongs to it.
  for (const chunk of body.split(/\n {2}\{/).slice(1)) {
    const one = <T>(re: RegExp, cast: (s: string) => T): T | null => {
      const m = chunk.match(re);
      return m ? cast(m[1]) : null;
    };
    const id = one(/id: '([^']+)'/, String);
    if (!id) continue;
    entries.push({
      id,
      label: one(/label: '([^']+)'/, String) ?? '',
      group: one(/group: '([^']+)'/, String) ?? '',
      menuSection: one(/menuSection: '([^']+)'/, String),
      chord: one(/chord: '([^']+)'/, String),
      pill: (() => {
        const m = chunk.match(/pill: \{ label: '([^']+)', priority: (\d+) \}/);
        return m ? { label: m[1], priority: Number(m[2]) } : null;
      })(),
    });
  }
  return entries;
}

const ACTIONS = registry();
const inGroup = (group: string): Entry[] => ACTIONS.filter((a) => a.group === group);
const idsUnder = (group: string, section: string): string[] =>
  inGroup(group)
    .filter((a) => a.menuSection === section)
    .map((a) => a.id);
const sectionOrder = (group: string): string[] => {
  const seen: string[] = [];
  for (const a of inGroup(group)) if (a.menuSection && seen[seen.length - 1] !== a.menuSection) seen.push(a.menuSection);
  return seen;
};

describe('the command registry', () => {
  it('reads every command out of main.ts', () => {
    expect(ACTIONS.length).toBe(71);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });

  it('never gives one chord to two commands', () => {
    // Two commands on one chord means the second never runs, and the
    // shortcuts sheet prints a key that does something else.
    const taken = new Map<string, string>();
    const clashes: string[] = [];
    for (const a of ACTIONS) {
      if (!a.chord) continue;
      const held = taken.get(a.chord);
      if (held) clashes.push(`${a.chord}: ${held} and ${a.id}`);
      else taken.set(a.chord, a.id);
    }
    expect(clashes).toEqual([]);
  });

  it('gives every command in a sectioned menu a heading to sit under', () => {
    const homeless = ACTIONS.filter((a) => a.group !== 'View' && !a.menuSection);
    expect(homeless.map((a) => a.id)).toEqual([]);
  });

  it('leaves View unsectioned, because six related commands need no headings', () => {
    expect(inGroup('View').map((a) => a.menuSection)).toEqual([null, null, null, null, null, null]);
  });

  it('keeps each heading in one run, so a section is never drawn twice', () => {
    for (const group of ['Notes', 'Writing', 'Window']) {
      const order = sectionOrder(group);
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('files the Note menu under the headings the design settled on', () => {
    expect(sectionOrder('Notes')).toEqual(['Create', 'Find and navigate', 'This note', 'Tabs', 'Saved searches', 'Folders', 'Library']);
    expect(idsUnder('Notes', 'Create')).toEqual(['new', 'template-new', 'import', 'journal-today', 'journal-date', 'folder-new']);
    expect(idsUnder('Notes', 'Find and navigate')).toEqual(['find', 'recent', 'prev', 'next', 'back', 'forward']);
    expect(idsUnder('Notes', 'This note')).toEqual(['title', 'aliases', 'properties', 'pin', 'history', 'save', 'export', 'merge-into', 'delete', 'note-move', 'note-show']);
    expect(idsUnder('Notes', 'Tabs')).toEqual(['tab-new', 'tab-close', 'tab-next', 'tab-prev']);
    expect(idsUnder('Notes', 'Saved searches')).toEqual(['view-save', 'view-open', 'view-forget']);
    // Folders sits immediately before Library: the notebook's own tree, then
    // the things that are about the notebook as a whole.
    expect(idsUnder('Notes', 'Folders')).toEqual(['folder-rename', 'folder-move', 'folder-delete']);
    expect(idsUnder('Notes', 'Library')).toEqual(['due', 'tag-rename', 'properties-all', 'trash', 'folder']);
  });

  it('files the Write menu the same way', () => {
    expect(sectionOrder('Writing')).toEqual(['Edit', 'Insert', 'Table', 'Move']);
    expect(idsUnder('Writing', 'Edit')).toEqual(['undo', 'redo', 'find-in-note', 'replace-in-note']);
    expect(idsUnder('Writing', 'Insert')).toEqual(['attach', 'divider', 'code', 'task', 'template-insert', 'block-copy', 'block-link', 'date']);
    expect(idsUnder('Writing', 'Table')).toEqual(['table', 'table-row', 'table-column', 'table-remove-row']);
    expect(idsUnder('Writing', 'Move')).toEqual(['move-lines', 'move-section']);
  });

  it('splits Window between the workspace and the application', () => {
    expect(sectionOrder('Window')).toEqual(['Workspace', 'Application']);
    expect(idsUnder('Window', 'Workspace')).toEqual(['sidebar', 'split', 'pane-close', 'pane-next', 'pane-prev', 'folders-go']);
    expect(idsUnder('Window', 'Application')).toEqual(['layout', 'palette', 'help']);
  });

  it('gives a button to four commands, and says in what order a narrow pane drops them', () => {
    const pills = ACTIONS.filter((a) => a.pill);
    expect(pills.map((a) => [a.id, a.pill?.label, a.pill?.priority])).toEqual([
      ['attach', 'Attach', 1],
      ['divider', 'Divider', 2],
      ['task', 'Task', 4],
      ['date', 'Date', 3],
    ]);
    // Highest priority survives longest, so the pane sheds Attach, Divider,
    // Date, Task in that order.
    const shed = [...pills].sort((a, b) => (a.pill?.priority ?? 0) - (b.pill?.priority ?? 0)).map((a) => a.id);
    expect(shed).toEqual(['attach', 'divider', 'date', 'task']);
  });

  it('keeps the buttons short enough to stay in the uppercase register', () => {
    for (const a of ACTIONS) if (a.pill) expect(a.pill.label.length).toBeLessThanOrEqual(8);
  });

  it('holds the line on formatting: no bold, italic, heading or list command', () => {
    const formatting = ACTIONS.filter((a) => /^(bold|italic|heading|link|quote|bullet-list|numbered-list)$/.test(a.id));
    expect(formatting).toEqual([]);
    expect(ACTIONS.some((a) => a.chord === 'ctrl+b' || a.chord === 'ctrl+i')).toBe(false);
  });
});
