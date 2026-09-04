import type { Action } from './actions';

/**
 * The menu a right-click on a note in the list opens.
 *
 * This is the sixth surface to read the one `ACTIONS` registry, and like the
 * pane's menus it is a *view* of one section — `Notes` / `This note` — rather
 * than a list of its own. A command cannot drift out of it, and a command
 * added to that section is offered here without anything being written twice.
 *
 * What it does not inherit is the target. Everywhere else "this note" means
 * the note on screen; here it means the row under the pointer, which is why
 * `main.ts` reads these rows with that note in view — what is greyed is true
 * of the note you clicked, not of the one you happen to be reading.
 */

/**
 * The rows, in the order they are drawn. `null` is a rule between groups.
 *
 * The grouping is by what a command does to a note, not by how often it is
 * wanted: what it *is*, then where it *lives*, then what becomes *of* it,
 * and last, alone under its own rule, the one that cannot be undone.
 */
export const NOTE_MENU: ReadonlyArray<string | null> = [
  'pin',
  'title',
  'properties',
  null,
  'note-move',
  'note-unfile',
  null,
  'export',
  'merge-into',
  'note-show',
  null,
  'delete',
];

/**
 * The commands that drive the pane's own editor — the title field, the
 * property sheet — and so cannot act on a note that is not in it. Run from
 * this menu they bring the note on screen first, because that is what they
 * mean; every other row leaves the selection exactly where it was.
 */
export const GOES_THERE: ReadonlySet<string> = new Set(['title', 'properties']);

export type NoteMenuRow = { kind: 'action'; action: Action } | { kind: 'rule' };

/**
 * The rows to draw, resolved against the registry.
 *
 * A command named here but absent from the registry is skipped rather than
 * drawn empty, and the rules close up after it: a menu never opens on a
 * leading rule, a trailing one, or two in a row.
 */
export function noteMenuRows(actions: readonly Action[]): NoteMenuRow[] {
  const rows: NoteMenuRow[] = [];
  for (const id of NOTE_MENU) {
    if (id === null) {
      // Only ever between two commands, so an absent one takes its rule with it.
      if (rows.length > 0 && rows[rows.length - 1].kind === 'action') rows.push({ kind: 'rule' });
      continue;
    }
    const action = actions.find((a) => a.id === id);
    if (action) rows.push({ kind: 'action', action });
  }
  while (rows.length > 0 && rows[rows.length - 1].kind === 'rule') rows.pop();
  return rows;
}
