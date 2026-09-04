import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GOES_THERE, NOTE_MENU } from './notemenu';

/**
 * The right-click menu's target, guarded from the source.
 *
 * `ACTIONS` cannot be imported — every command closes over the renderer — so
 * this reads `main.ts` as text, the same trick `registry.test.ts` uses. What
 * it is protecting is a silent failure: a command body that goes back to
 * reading `selected()` still compiles, still passes every other test, and acts
 * on the wrong note only when it was reached from a right-click.
 */
const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

/** One function's body, from its signature to the closing brace in column one. */
function body(name: string): string {
  const at = source.search(new RegExp(`\\n(?:async )?function ${name}(?:<[^>]*>)?\\(`));
  expect(at, `${name} is not a function in main.ts`).toBeGreaterThan(-1);
  const rest = source.slice(at + 1);
  const end = rest.indexOf('\n}\n');
  return rest.slice(0, end);
}

describe('the note a command is about', () => {
  it('falls back to the note on screen, so nothing changes when no menu named one', () => {
    expect(source).toContain('const targeted = (): Note | null => (noteTarget === null ? selected() :');
  });

  it('puts the target back afterwards, even when the command throws', () => {
    const run = body('onNote');
    expect(run).toContain('finally');
    expect(run).toContain('noteTarget = before;');
  });

  it('leaves rendering on the selection, so a target can never draw the wrong note', () => {
    for (const name of ['renderList', 'renderEditor']) {
      expect(body(name)).not.toContain('targeted()');
    }
  });

  // Each of these is reached from the right-click menu and must act on the row
  // that was clicked. Reading `selected()` here is the bug this test exists for.
  it.each(['togglePinSelected', 'runExport', 'showNoteFile', 'moveNoteToFolder', 'unfileNote', 'armDelete'])('has %s ask for the targeted note', (name) => {
    const fn = body(name);
    expect(fn).toContain('targeted()');
    expect(fn).not.toContain('selected()');
  });

  it('greys a command against the clicked note rather than the open one', () => {
    // `hasNote` gates most of the section, and `menuRow` reads it while the
    // target is set: a right-click on a note must never grey its own commands.
    expect(source).toContain('const hasNote = (): boolean => targeted() !== null;');
    expect(source).toContain("enabled: () => (targeted()?.folder ?? ROOT_FOLDER) !== ROOT_FOLDER,");
    expect(source).toContain('on: () => targeted()?.pinned === true,');
  });
});

describe('deleting a note that is not the one being read', () => {
  it('deletes by name rather than by whatever is selected now', () => {
    expect(source).toMatch(/function deleteNote\(id: string\): void \{/);
  });

  it('remembers which note the first press asked about', () => {
    const arm = body('armDelete');
    expect(arm).toContain('armed && armedId === n.id');
    expect(arm).toContain('armedId = n.id;');
    // Asking about a different note is a new question, not an answer.
    expect(arm).toContain('if (armed) disarmDelete();');
  });

  it('forgets the note when it disarms, so a stale id can never be answered', () => {
    expect(body('disarmDelete')).toContain('armedId = null;');
  });

  it('leaves the screen alone unless the note deleted was the one on it', () => {
    const del = body('deleteNote');
    expect(del).toContain('const onScreen = ui.selectedId === id;');
    expect(del).toContain('if (onScreen) {');
    expect(del).toContain('renderList();');
  });
});

describe('where the menu is wired', () => {
  it('opens on a right-click on a row in the list', () => {
    expect(source).toContain("el.list.addEventListener('contextmenu'");
  });

  it('takes the event only on a note, so the editor keeps its spelling menu', () => {
    const at = source.indexOf("el.list.addEventListener('contextmenu'");
    const handler = source.slice(at, source.indexOf('\n});', at));
    // The guard has to come before the preventDefault, or the native menu is
    // suppressed on the empty part of the list too.
    expect(handler.indexOf('if (!id) return;')).toBeGreaterThan(-1);
    expect(handler.indexOf('if (!id) return;')).toBeLessThan(handler.indexOf('e.preventDefault();'));
  });

  it('is the only place in the app that suppresses the native menu', () => {
    expect(source.match(/'contextmenu'/g)).toHaveLength(1);
  });

  it('draws the rows with the clicked note in view', () => {
    expect(body('fillNoteMenu')).toContain('onNote(id, () => {');
  });

  it('sends the two editor-bound commands to the note before running them', () => {
    const run = body('runFromNoteMenu');
    expect(run).toContain('GOES_THERE.has(action.id)');
    expect(run).toContain('if (ui.selectedId !== id) select(id);');
    // Everything else runs where it stands.
    expect(run).toContain('onNote(id, () => action.run());');
  });

  it('shows the export formats in this menu, not the pane’s', () => {
    const run = body('runFromNoteMenu');
    expect(run).toContain("action.id === 'export'");
    expect(run).toContain('exportPage(panel);');
    expect(run).not.toContain("openMenu('Notes', 'export')");
  });

  it('walks with the same keys as the pane’s own menus', () => {
    expect(body('onNoteMenuKey')).toContain('panelKey(panel, e)');
    // The pane's handler was made to share it rather than keep a second copy.
    const controls = source.slice(source.indexOf("onPane('controls', 'keydown'"));
    expect(controls.slice(0, controls.indexOf('\n});'))).toContain('if (panelKey(panel, e)) return;');
  });

  it('closes on a click anywhere outside it', () => {
    expect(source).toContain('if (noteMenu && !noteMenu.contains(e.target as Node)) closeNoteMenu();');
  });

  it('marks the row it is about, and unmarks it on the way out', () => {
    // The commands act on this note rather than the one being read, so once
    // the pointer moves off the row nothing else would say which note it is.
    expect(body('openNoteMenu')).toContain("noteMenuRow?.classList.add('menued');");
    expect(body('closeNoteMenu')).toContain("noteMenuRow?.classList.remove('menued');");
    // The list's own hover colour, not a second kind of selection.
    const rule = css.slice(css.indexOf('.item.menued {'), css.indexOf('}', css.indexOf('.item.menued {')));
    expect(rule).toContain('background: var(--hover);');
    expect(rule).not.toContain('border-left');
  });
});

describe('what the menu is made of', () => {
  it('is the pane’s panel, moved to the pointer', () => {
    expect(source).toContain("panel.className = 'menu menu-at';");
    expect(css).toContain('.menu-at {');
    // It must beat `.menu`'s own absolute placement under a button.
    const rule = css.slice(css.indexOf('.menu-at {'), css.indexOf('}', css.indexOf('.menu-at {')));
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('right: auto;');
  });

  it('rules its groups in the one border colour, adding no palette of its own', () => {
    const rule = css.slice(css.indexOf('.menu-rule {'), css.indexOf('}', css.indexOf('.menu-rule {')));
    expect(rule).toContain('background: var(--line);');
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
  });

  it('shares the placement arithmetic with the peek card and the slash menu', () => {
    expect(source).toContain("import { place } from './anchored';");
    expect(body('placeNoteMenu')).toContain('place({ left: noteMenuAt.x');
  });
});

describe('the menu and the registry agree', () => {
  it('names a command main.ts actually has', () => {
    for (const id of NOTE_MENU) {
      if (id === null) continue;
      expect(source, `${id} is in the menu but not in ACTIONS`).toContain(`    id: '${id}',`);
    }
  });

  it('has the new command take a note out of a folder and say so', () => {
    expect(source).toContain("    id: 'note-unfile',");
    expect(source).toContain("    label: 'Take out of folder',");
    expect(body('unfileNote')).toContain('window.notesApi.moveNote(n.id, ROOT_FOLDER)');
  });

  it('keeps the two editor-bound commands in the menu it excuses them from', () => {
    for (const id of GOES_THERE) expect(NOTE_MENU).toContain(id);
  });
});
