import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Action } from './actions';
import { GOES_THERE, NOTE_MENU, noteMenuRows } from './notemenu';

const act = (id: string, extra: Partial<Action> = {}): Action => ({ id, label: id, group: 'Notes', run: () => {}, ...extra });

/** Every id the menu names, as a registry to resolve them against. */
const full = NOTE_MENU.filter((id): id is string => id !== null).map((id) => act(id));

const ids = (rows: ReturnType<typeof noteMenuRows>): string[] => rows.map((r) => (r.kind === 'rule' ? '—' : r.action.id));

describe('the menu a right-click on a note opens', () => {
  it('draws the section in the order the design settled on', () => {
    expect(ids(noteMenuRows(full))).toEqual([
      'pin',
      'title',
      'properties',
      '—',
      'note-move',
      'note-unfile',
      '—',
      'export',
      'merge-into',
      'note-show',
      '—',
      'delete',
    ]);
  });

  it('puts delete alone under the last rule, because it is the one that cannot be taken back', () => {
    const rows = ids(noteMenuRows(full));
    expect(rows[rows.length - 1]).toBe('delete');
    expect(rows[rows.length - 2]).toBe('—');
  });

  it('closes the rules up around a command the registry does not have', () => {
    // Neither of the pair between two rules: the rule that named them goes too.
    const thin = full.filter((a) => a.id !== 'note-move' && a.id !== 'note-unfile');
    expect(ids(noteMenuRows(thin))).toEqual(['pin', 'title', 'properties', '—', 'export', 'merge-into', 'note-show', '—', 'delete']);
  });

  it('never opens on a rule, ends on one, or draws two together', () => {
    for (const drop of NOTE_MENU.filter((id): id is string => id !== null)) {
      const rows = ids(noteMenuRows(full.filter((a) => a.id !== drop)));
      expect(rows[0]).not.toBe('—');
      expect(rows[rows.length - 1]).not.toBe('—');
      expect(rows.some((r, i) => r === '—' && rows[i + 1] === '—')).toBe(false);
    }
  });

  it('draws nothing at all rather than a bare rule when the registry is empty', () => {
    expect(noteMenuRows([])).toEqual([]);
  });

  it('keeps what cannot run, because a menu is a map and a map holds still', () => {
    // The 0.21.0 rule: greying is main.ts's business, and this list never
    // filters. Every id asked for comes back when the registry has it.
    const rows = noteMenuRows(full.map((a) => ({ ...a, enabled: () => false })));
    expect(rows.filter((r) => r.kind === 'action')).toHaveLength(full.length);
  });

  it('names only commands the registry files under This note', () => {
    // The menu is a view of one section. If a command named here is moved or
    // renamed in main.ts, this fails rather than the row quietly vanishing.
    const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
    for (const id of NOTE_MENU) {
      if (id === null) continue;
      const entry = source.slice(source.indexOf(`\n    id: '${id}',`));
      expect(entry.slice(0, entry.indexOf('\n  },'))).toContain("menuSection: 'This note'");
    }
  });

  it('sends only the two editor-bound commands to the note first', () => {
    expect([...GOES_THERE].sort()).toEqual(['properties', 'title']);
    for (const id of GOES_THERE) expect(NOTE_MENU).toContain(id);
  });
});
