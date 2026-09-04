/**
 * The sidebar's shape, read out of the page and the stylesheet.
 *
 * The rail is built in `main.ts`, which cannot be imported into a test, but
 * the order of its parts is settled in `index.html` and it is the whole point
 * of the 0.22 design: folders above the list because the list is what is in
 * the folder, tags below it because they are a second question. A refactor
 * that quietly reorders them would leave every other test passing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');

/** Where each id appears in the page, so their order can be compared. */
const at = (id: string): number => {
  const found = page.indexOf(`id="${id}"`);
  expect(found, `${id} is not in index.html`).toBeGreaterThan(0);
  return found;
};

describe('the sidebar', () => {
  it('puts the folders above the note list and the tags below it', () => {
    expect(at('search')).toBeLessThan(at('views'));
    expect(at('views')).toBeLessThan(at('folder-tree'));
    expect(at('folder-tree')).toBeLessThan(at('list'));
    // Tags moved under the list in 0.22: folders are where a note lives and
    // are browsed, tags are what is true about it and are a filter.
    expect(at('list')).toBeLessThan(at('tags'));
  });

  it('always shows the Folders section, even before there is a folder', () => {
    const section = page.slice(page.indexOf('<section id="folders"'), page.indexOf('id="list"'));
    expect(section).not.toContain('hidden');
    // The restrained + is the only control the rail has, and it says what it is.
    expect(section).toContain('id="folder-add"');
    expect(section).toContain('New folder…');
  });

  it('folds the tag rail away, and only that one', () => {
    const rail = page.slice(page.indexOf('<section id="tag-rail"'), page.indexOf('</aside>'));
    expect(rail).toContain('hidden');
    expect(rail).toContain('aria-expanded="false"');
    expect(rail).toContain('aria-controls="tags"');
  });

  it('gives the pane header a breadcrumb that is a statement, not a control', () => {
    expect(page).toContain('data-el="where"');
    // It goes to the folder; filing the note is its own command, so an idle
    // click on a label can never move a note.
    expect(main).toContain("onPane('where', 'click'");
    expect(main).toContain('browseFolder(n.folder ?? ROOT_FOLDER)');
    expect(main).not.toContain("onPane('where', 'click', () => void moveNoteToFolder");
  });
});

describe('the folder rail, in the stylesheet', () => {
  it('marks the folder being browsed with the one accent the app has', () => {
    const rule = css.slice(css.indexOf(".folder[aria-pressed='true']"));
    expect(rule.slice(0, 200)).toContain('var(--margin)');
  });

  it('adds no colour of its own: every value it uses is a token', () => {
    const block = css.slice(css.indexOf('.rail {'), css.indexOf('.tags {'));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/\brgba?\(/);
  });
});
