import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import {
  createNote,
  neighborOf,
  removeNote,
  searchNotes,
  snippetOf,
  sortByEdited,
  tagsOf,
  allTags,
  backlinksOf,
  linksIn,
  linkMarkdown,
  linkParts,
  noteForLink,
  tagMatches,
  tagPath,
  tagTree,
  togglePin,
  updateTitle,
  exportBody,
  titleOf,
  updateBody,
  wordCount,
} from './notes';

describe('wordCount', () => {
  it('counts words and ignores markdown markers', () => {
    expect(wordCount('# Groceries\n\n- milk\n- eggs')).toBe(3);
  });
  it('keeps contractions together and handles empty text', () => {
    expect(wordCount("don't stop")).toBe(2);
    expect(wordCount('')).toBe(0);
    expect(wordCount('---\n***')).toBe(0);
  });
  it('does not count link or image targets', () => {
    expect(wordCount('see [the site](https://example.com/a/b) now')).toBe(4);
    expect(wordCount('![garden photo](note-asset://deadbeef.png)')).toBe(2);
  });
});

describe('titleOf with links and images', () => {
  it('uses alt and link text instead of URLs', () => {
    expect(titleOf({ body: '![Garden photo](note-asset://deadbeef.png)' })).toBe('Garden photo');
    expect(titleOf({ body: '[Docs](https://example.com) to read' })).toBe('Docs to read');
  });
});

const note = (id: string, body: string, updatedAt: number): Note => ({ id, body, createdAt: updatedAt, updatedAt });

describe('titleOf', () => {
  it('uses the first non-empty line', () => {
    expect(titleOf({ body: '\n\nGroceries\nmilk' })).toBe('Groceries');
  });
  it('strips heading, list and emphasis markers', () => {
    expect(titleOf({ body: '## **Plan** for _today_' })).toBe('Plan for today');
    expect(titleOf({ body: '- first item' })).toBe('first item');
    expect(titleOf({ body: '1. numbered' })).toBe('numbered');
  });
  it('falls back to Untitled', () => {
    expect(titleOf({ body: '' })).toBe('Untitled');
    expect(titleOf({ body: '   \n  ' })).toBe('Untitled');
    expect(titleOf({ body: '###' })).toBe('Untitled');
  });
});

describe('snippetOf', () => {
  it('skips the title line and joins the rest', () => {
    expect(snippetOf({ body: 'Title\n\n- milk\n- eggs' })).toBe('milk eggs');
  });
  it('is empty for a one-line note', () => {
    expect(snippetOf({ body: 'Just a title' })).toBe('');
  });
  it('truncates with an ellipsis', () => {
    const s = snippetOf({ body: `T\n${'word '.repeat(40)}` }, 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('sortByEdited', () => {
  it('puts the most recently edited first without mutating', () => {
    const list = [note('a', '', 1), note('b', '', 3), note('c', '', 2)];
    expect(sortByEdited(list).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(list.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('searchNotes', () => {
  const list = [note('a', 'Buy Milk and eggs', 1), note('b', 'Meeting notes\nmilk the process', 2), note('c', 'Nothing here', 3)];
  it('returns everything for an empty query', () => {
    expect(searchNotes(list, '')).toBe(list);
    expect(searchNotes(list, '   ')).toBe(list);
  });
  it('matches case-insensitively anywhere in the body', () => {
    expect(searchNotes(list, 'MILK').map((n) => n.id)).toEqual(['a', 'b']);
  });
  it('requires every term', () => {
    expect(searchNotes(list, 'milk eggs').map((n) => n.id)).toEqual(['a']);
    expect(searchNotes(list, 'milk zebra')).toEqual([]);
  });
});

describe('updateBody', () => {
  it('replaces the body and bumps updatedAt', () => {
    const out = updateBody([note('a', 'old', 1)], 'a', 'new', 99);
    expect(out[0]).toMatchObject({ body: 'new', updatedAt: 99 });
  });
  it('leaves the timestamp alone when nothing changed', () => {
    const out = updateBody([note('a', 'same', 1)], 'a', 'same', 99);
    expect(out[0].updatedAt).toBe(1);
  });
  it('does not touch other notes', () => {
    const out = updateBody([note('a', 'x', 1), note('b', 'y', 2)], 'a', 'z', 9);
    expect(out[1]).toEqual(note('b', 'y', 2));
  });
});

describe('removeNote / neighborOf', () => {
  const list = [note('a', '', 3), note('b', '', 2), note('c', '', 1)];
  it('removes by id', () => {
    expect(removeNote(list, 'b').map((n) => n.id)).toEqual(['a', 'c']);
  });
  it('prefers the next note down, then the one above, then nothing', () => {
    expect(neighborOf(list, 'a')).toBe('b');
    expect(neighborOf(list, 'c')).toBe('b');
    expect(neighborOf([list[0]], 'a')).toBeNull();
  });
  it('falls back to the first visible note when the id is not shown', () => {
    expect(neighborOf(list, 'zzz')).toBe('a');
    expect(neighborOf([], 'zzz')).toBeNull();
  });
});

describe('createNote', () => {
  it('has a unique id and equal timestamps', () => {
    const a = createNote(5);
    const b = createNote(5);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ body: '', createdAt: 5, updatedAt: 5 });
  });
});

describe('sized attachments', () => {
  const tag = '<img src="note-asset://deadbeef.png" alt="the garden" width="320">';
  it('use the alt text as title and snippet', () => {
    expect(titleOf({ body: `${tag}\nsecond line` })).toBe('the garden');
    expect(snippetOf({ body: `first\n${tag}` })).toBe('the garden');
  });
  it('count only the alt text as words', () => {
    expect(wordCount({ body: `hello ${tag} world` }.body)).toBe(4);
    expect(wordCount('<img src="note-asset://deadbeef.png" width="320">')).toBe(0);
  });
});

describe('pinning', () => {
  it('sorts pinned notes first, then by edit time', () => {
    const list = [note('a', '', 1), { ...note('b', '', 3) }, { ...note('c', '', 2), pinned: true }];
    expect(sortByEdited(list).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });
  it('toggles without touching the edit time', () => {
    const on = togglePin([note('a', 'x', 5)], 'a');
    expect(on[0]).toEqual({ ...note('a', 'x', 5), pinned: true });
    const off = togglePin(on, 'a');
    expect(off[0]).toEqual(note('a', 'x', 5));
    expect('pinned' in off[0]).toBe(false);
  });
});

describe('createNote with a body', () => {
  it('seeds the body', () => {
    expect(createNote(1, 'Title\n').body).toBe('Title\n');
  });
});

describe('tags', () => {
  it('finds #tags at line starts and after spaces, lower-cased and unique', () => {
    expect(tagsOf('#Work plan\nsee #work and #home-office, #v2_draft')).toEqual(['work', 'home-office', 'v2_draft']);
  });
  it('ignores headings, numbers, urls and mid-word hashes', () => {
    expect(tagsOf('# Heading\n#1 and #123\nhttps://x.com/#anchor\nC#')).toEqual([]);
  });
  it('counts tags across notes, most used first', () => {
    const list = [note('a', '#x #y', 1), note('b', '#y', 2), note('c', 'none', 3)];
    expect(allTags(list)).toEqual([
      { tag: 'y', count: 2 },
      { tag: 'x', count: 1 },
    ]);
  });
  it('searches tags with #terms and narrows by an exact tag', () => {
    const list = [note('a', 'milk #shop', 1), note('b', '#shopping list', 2), note('c', 'shop talk', 3)];
    expect(searchNotes(list, '#shop').map((n) => n.id)).toEqual(['a', 'b']);
    expect(searchNotes(list, '#shopping').map((n) => n.id)).toEqual(['b']);
    expect(searchNotes(list, 'milk #shop').map((n) => n.id)).toEqual(['a']);
    expect(searchNotes(list, '', 'shop').map((n) => n.id)).toEqual(['a']);
    expect(searchNotes(list, 'list', 'shop')).toEqual([]);
    expect(searchNotes(list, '#').map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('explicit titles', () => {
  it('win over the first line for title and snippet', () => {
    const n = { body: 'first line\nsecond', title: 'Plans' };
    expect(titleOf(n)).toBe('Plans');
    expect(snippetOf(n)).toBe('first line second');
    expect(titleOf({ body: 'first', title: '  ' })).toBe('first');
  });
  it('are searchable', () => {
    const list = [{ ...note('a', 'body only', 1), title: 'Zebra' }, note('b', 'no zebra here? yes zebra', 2)];
    expect(searchNotes(list, 'zebra').map((n) => n.id)).toEqual(['a', 'b']);
    expect(searchNotes(list, 'only').map((n) => n.id)).toEqual(['a']);
  });
  it('set, trim, clear and bump the edit time', () => {
    const set = updateTitle([note('a', 'x', 1)], 'a', '  Plans ', 9);
    expect(set[0]).toEqual({ ...note('a', 'x', 1), updatedAt: 9, title: 'Plans' });
    const same = updateTitle(set, 'a', 'Plans', 20);
    expect(same[0].updatedAt).toBe(9);
    const cleared = updateTitle(set, 'a', '', 30);
    expect(cleared[0]).toEqual({ ...note('a', 'x', 1), updatedAt: 30 });
    expect('title' in cleared[0]).toBe(false);
  });
  it('go out as a heading on export', () => {
    expect(exportBody({ body: 'text', title: 'Plans' })).toBe('# Plans\n\ntext');
    expect(exportBody({ body: 'text' })).toBe('text');
  });
});

describe('nested tags', () => {
  it('reads a tag with slashes as one tag', () => {
    expect(tagsOf('#wow/commands and #wow/server')).toEqual(['wow/commands', 'wow/server']);
  });
  it('stops before a trailing slash', () => {
    expect(tagsOf('#wow/ and #wow//x')).toEqual(['wow']);
  });
  it('names the tags a tag sits under, outermost first', () => {
    expect(tagPath('wow/commands/npc')).toEqual(['wow', 'wow/commands', 'wow/commands/npc']);
    expect(tagPath('wow')).toEqual(['wow']);
  });
  it('matches a tag against the one it is filed under', () => {
    expect(tagMatches('wow/commands', 'wow')).toBe(true);
    expect(tagMatches('wow', 'wow')).toBe(true);
    expect(tagMatches('wowza', 'wow')).toBe(false);
  });
  it('rolls child counts up into the parent, counting a note once', () => {
    const list = [note('a', '#wow/commands #wow/server', 1), note('b', '#wow/commands', 2), note('c', '#home', 3)];
    const tree = tagTree(list);
    expect(tree.map((t) => [t.tag, t.count])).toEqual([
      ['wow', 2],
      ['home', 1],
    ]);
    expect(tree[0].children.map((t) => [t.tag, t.label, t.count])).toEqual([
      ['wow/commands', 'commands', 2],
      ['wow/server', 'server', 1],
    ]);
  });
  it('gives a parent nobody wrote a place in the tree', () => {
    const tree = tagTree([note('a', '#wow/commands', 1)]);
    expect(tree.map((t) => t.tag)).toEqual(['wow']);
    expect(tree[0].children.map((t) => t.tag)).toEqual(['wow/commands']);
  });
  it('filters by a parent tag, children included', () => {
    const list = [note('a', '#wow/commands', 1), note('b', '#wow', 2), note('c', '#wowza', 3)];
    expect(searchNotes(list, '', 'wow').map((n) => n.id)).toEqual(['a', 'b']);
    expect(searchNotes(list, '', 'wow/commands').map((n) => n.id)).toEqual(['a']);
  });
});

describe('links between notes', () => {
  it('finds link targets in order, without repeats or case duplicates', () => {
    expect(linksIn('see [[One]] and [[Two]], then [[one]] again')).toEqual(['One', 'Two']);
  });
  it('ignores an unclosed or empty link, and one broken across lines', () => {
    expect(linksIn('[[ ]] [[open and [[a\nb]]')).toEqual([]);
  });
  it('points an aliased link at its target, the way a rename already read it', () => {
    expect(linksIn('see [[Plan|the plan]] and [[plan]]')).toEqual(['Plan']);
    expect(linkParts('Plan|the plan')).toEqual({ target: 'Plan', alias: 'the plan' });
    expect(linkParts('Plan|')).toEqual({ target: 'Plan' });
    expect(linkMarkdown('Plan', 'the plan')).toBe('[[Plan|the plan]]');
  });
  it('reads a link through the title of the note it names', () => {
    const list = [note('a', 'body', 1), { ...note('b', 'body', 2), title: 'Reading list' }];
    expect(noteForLink(list, ' reading LIST ')?.id).toBe('b');
    expect(noteForLink(list, 'nothing here')).toBe(null);
  });
  it('finds the notes that link to one, and never the note itself', () => {
    const target = { ...note('t', 'about [[Plans]] itself', 1), title: 'Plans' };
    const list = [target, note('a', 'see [[plans]]', 2), note('b', 'nothing', 3)];
    expect(backlinksOf(list, 't').map((n) => n.id)).toEqual(['a']);
    expect(backlinksOf(list, 'missing')).toEqual([]);
  });
  it('reads a link as its words in titles and snippets', () => {
    expect(titleOf({ body: 'go to [[Other note]] now' })).toBe('go to Other note now');
  });
});
