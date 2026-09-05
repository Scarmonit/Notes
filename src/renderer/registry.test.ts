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
  slash: boolean;
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
      slash: /\n\s*slash: true,/.test(chunk),
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
    // 0.28.0 added eight: two inserts (callout, footnote), the footnotes rail,
    // three folding commands, the layout of a search, and opening an attachment.
    expect(ACTIONS.length).toBe(82);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });

  it('offers only the insert-shaped commands behind a slash', () => {
    // The palette answers "what can Notes do?"; a slash answers "what can
    // Notes insert here?". A command that does not put something at the
    // caret has no business in this menu, and no formatting command has any
    // business in the registry at all.
    expect(ACTIONS.filter((a) => a.slash).map((a) => a.id)).toEqual(['attach', 'divider', 'callout', 'footnote', 'task', 'template-insert', 'block-link', 'date', 'table']);
    for (const a of ACTIONS.filter((x) => x.slash)) expect([a.id, a.group], a.id).toEqual([a.id, 'Writing']);
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
    const homeless = ACTIONS.filter((a) => !a.menuSection);
    expect(homeless.map((a) => a.id)).toEqual([]);
  });

  it('sections View now that folding joined it: how the note reads, how to move about it, what folds, the workspace', () => {
    expect(sectionOrder('View')).toEqual(['Reading', 'Navigation', 'Folding', 'Workspace']);
    expect(idsUnder('View', 'Reading')).toEqual(['preview', 'live']);
    expect(idsUnder('View', 'Navigation')).toEqual(['outline', 'footnotes']);
    expect(idsUnder('View', 'Folding')).toEqual(['fold-toggle', 'fold-all', 'unfold-all']);
    expect(idsUnder('View', 'Workspace')).toEqual(['focus', 'typewriter', 'peek', 'graph']);
  });

  it('keeps each heading in one run, so a section is never drawn twice', () => {
    for (const group of ['Notes', 'Writing', 'View', 'Window']) {
      const order = sectionOrder(group);
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('files the Note menu under the headings the design settled on', () => {
    expect(sectionOrder('Notes')).toEqual(['Create', 'Find and navigate', 'This note', 'Tabs', 'Saved searches', 'Folders', 'Library']);
    expect(idsUnder('Notes', 'Create')).toEqual(['new', 'template-new', 'import', 'journal-today', 'journal-date', 'folder-new']);
    expect(idsUnder('Notes', 'Find and navigate')).toEqual(['find', 'recent', 'prev', 'next', 'back', 'forward']);
    expect(idsUnder('Notes', 'This note')).toEqual(['title', 'aliases', 'properties', 'pin', 'history', 'save', 'export', 'merge-into', 'delete', 'note-move', 'note-unfile', 'note-show']);
    expect(idsUnder('Notes', 'Tabs')).toEqual(['tab-new', 'tab-close', 'tab-next', 'tab-prev']);
    expect(idsUnder('Notes', 'Saved searches')).toEqual(['view-save', 'view-open', 'view-forget', 'view-layout']);
    // Folders sits immediately before Library: the notebook's own tree, then
    // the things that are about the notebook as a whole.
    expect(idsUnder('Notes', 'Folders')).toEqual(['folder-rename', 'folder-move', 'folder-delete']);
    expect(idsUnder('Notes', 'Library')).toEqual(['due', 'tag-rename', 'properties-all', 'trash', 'folder']);
  });

  it('files the Write menu the same way', () => {
    expect(sectionOrder('Writing')).toEqual(['Edit', 'Insert', 'Table', 'Move']);
    expect(idsUnder('Writing', 'Edit')).toEqual(['undo', 'redo', 'find-in-note', 'replace-in-note', 'attachment-open']);
    expect(idsUnder('Writing', 'Insert')).toEqual(['attach', 'divider', 'callout', 'footnote', 'code', 'task', 'template-insert', 'block-copy', 'block-link', 'date']);
    expect(idsUnder('Writing', 'Table')).toEqual(['table', 'table-row', 'table-column', 'table-remove-row']);
    expect(idsUnder('Writing', 'Move')).toEqual(['move-lines', 'move-section']);
  });

  it('splits Window between the workspace and the application', () => {
    expect(sectionOrder('Window')).toEqual(['Workspace', 'Application']);
    expect(idsUnder('Window', 'Workspace')).toEqual(['sidebar', 'split', 'pane-close', 'pane-next', 'pane-prev', 'folders-go', 'workspaces']);
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

  it('gives the eight commands of 0.28.0 the chords the design settled on', () => {
    const chordOf = (id: string): string | null => ACTIONS.find((a) => a.id === id)?.chord ?? null;
    expect(chordOf('callout')).toBe('ctrl+alt+c');
    expect(chordOf('footnote')).toBe('ctrl+alt+e');
    expect(chordOf('footnotes')).toBe('ctrl+alt+o');
    // No Shift with a bracket: `event.key` would arrive as `{`, which is the 0.26.0 backslash trap again.
    expect(chordOf('fold-toggle')).toBe('ctrl+alt+.');
    expect(chordOf('fold-all')).toBe('ctrl+alt+[');
    expect(chordOf('unfold-all')).toBe('ctrl+alt+]');
    expect(chordOf('view-layout')).toBe('ctrl+alt+v');
    expect(chordOf('attachment-open')).toBe('ctrl+alt+a');
    // Ctrl+Alt+N is the window's own summon hotkey, registered with Windows; it must not be spent here.
    expect(ACTIONS.some((a) => a.chord === 'ctrl+alt+n')).toBe(false);
  });

  it('renamed Attach for every kind of file, keeping its place', () => {
    const attach = ACTIONS.find((a) => a.id === 'attach');
    expect(attach?.label).toBe('Attach a file…');
    expect(attach?.chord).toBe('ctrl+shift+i');
  });

  it('holds the line on formatting: no bold, italic, heading or list command', () => {
    const formatting = ACTIONS.filter((a) => /^(bold|italic|heading|link|quote|bullet-list|numbered-list)$/.test(a.id));
    expect(formatting).toEqual([]);
    expect(ACTIONS.some((a) => a.chord === 'ctrl+b' || a.chord === 'ctrl+i')).toBe(false);
  });
});
