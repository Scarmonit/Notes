import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The window's wiring, guarded from the source.
 *
 * Everything here is a way a key or a command quietly did nothing at all: no
 * error, no status line, no crash, and every other test still green. `main.ts`
 * cannot be imported — it runs against the real document the moment it loads —
 * so this reads it as text, the same trick `registry.test.ts` and
 * `targeting.test.ts` use.
 */
const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');

/** One function's body, from its signature to the closing brace in column one. */
function body(name: string): string {
  const at = source.search(new RegExp(`\\n(?:async )?function ${name}(?:<[^>]*>)?\\(`));
  expect(at, `${name} is not a function in main.ts`).toBeGreaterThan(-1);
  const rest = source.slice(at + 1);
  return rest.slice(0, rest.indexOf('\n}\n'));
}

describe('Tab in a table that is already laid out', () => {
  it('moves the caret even when the text does not change', () => {
    // `stepCell` re-lays the table out, so on a table that is already tidy the
    // body comes back identical while the caret has moved. Returning true on
    // that without placing the caret swallowed Tab and moved nothing — and a
    // freshly inserted table is tidy from the start, so it was every table.
    const fn = body('applyTableEdit');
    expect(fn).not.toContain('if (!next || next.body === text) return Boolean(next);');
    expect(fn).toContain('if (!next) return false;');
    const same = fn.indexOf('if (next.body === text) {');
    expect(same).toBeGreaterThan(-1);
    expect(fn.slice(same, fn.indexOf('}', same))).toContain('placeCaretAt(next.caret);');
  });
});

describe('a menu asked for while the pane header is hidden', () => {
  it('does not hang itself on a button nobody can see', () => {
    // Hiding the controls hides the buttons only: "every command, every chord
    // and the palette go on working". Opening a menu on a hidden button showed
    // nothing while still claiming the next Escape.
    const fn = body('openMenu');
    expect(fn).toContain("if (!button || button.offsetParent === null) {");
  });

  it('still offers the export formats, which had no other way in', () => {
    // `export`'s whole body is `openMenu('Notes', 'export')`, so with the
    // header hidden the chord and the palette both did nothing.
    expect(body('openMenu')).toContain("if (drill === 'export') pickExportKind();");
    expect(source).toContain('function pickExportKind(): void {');
    expect(body('pickExportKind')).toContain('EXPORT_KINDS.map');
  });
});

describe('what the window has read when it first draws', () => {
  it('draws the list again once the settings have arrived', () => {
    // The saved-search rail comes out of the settings, and the list was drawn
    // before they were read — so the rail was missing until something else
    // happened to redraw it, up to a minute later.
    const init = body('init');
    const settings = init.indexOf('await window.notesApi.getSettings()');
    expect(settings).toBeGreaterThan(-1);
    expect(init.indexOf('renderList();', settings)).toBeGreaterThan(settings);
  });
});

describe('leaving a folder', () => {
  it('forgets it in the state that is written down, not only the one on screen', () => {
    // `folderScope` is this session's; `ui.folder` is what is saved and read
    // back. Clearing one and not the other reopened the window in a folder the
    // reader had left, with the note they were reading not in the list.
    const fn = body('clearFilters');
    expect(fn).toContain('folderScope = ROOT_FOLDER;');
    expect(fn).toContain('ui.folder = ROOT_FOLDER;');
  });
});

describe('a link peeked at while a card is pinned', () => {
  it('cancels the hover it started, rather than leaving it to fire', () => {
    // `unhover` cancels the pending open before it looks at the card, so a
    // pinned card is safe inside it. Skipping the call left that timer to
    // replace the pinned card with one for a link the pointer had left — and
    // with the pointer elsewhere, nothing was ever going to close it.
    const at = source.indexOf("'pointerout'");
    expect(at).toBeGreaterThan(-1);
    const handler = source.slice(at, source.indexOf('\n);', at));
    expect(handler).toContain('if (target) peek.unhover();');
    expect(handler).not.toContain('!peek.isPinned()');
  });
});

describe('the chord that splits the pane', () => {
  it('is spelled the way the key actually arrives', () => {
    // `chordOf` reads `event.key`, which reports the character the key makes:
    // Shift and backslash is '|', so 'ctrl+shift+\\' could never be produced.
    expect(source).toContain("chord: 'ctrl+shift+|',");
    expect(source).not.toContain("chord: 'ctrl+shift+\\\\',");
  });

  it('leaves the unshifted one alone, which was always right', () => {
    expect(source).toContain("chord: 'ctrl+\\\\',");
  });
});
