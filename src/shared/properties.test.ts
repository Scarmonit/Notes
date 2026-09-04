import { describe, expect, it } from 'vitest';
import { formatNoteFile, parseNoteFile, propertiesOf, withoutProperty, withProperty, type FrontMatterEntry } from './notes-folder';

import { isPlain, parseScalar, parseTyped, propertyHas, typeOfValue, writeProperty, writeScalar } from './properties';

/** The entries the app does not own, which is what a property is. */
const theirs = (entries: readonly FrontMatterEntry[]): FrontMatterEntry[] => entries.filter((e) => e.owned === undefined);

const facts = { id: 'fallback', name: 'File', mtime: 5000 };

describe('reading a scalar', () => {
  it('takes only true, false, null and a plain number for something other than text', () => {
    expect(parseScalar('true')).toBe(true);
    expect(parseScalar('false')).toBe(false);
    expect(parseScalar('null')).toBe(null);
    expect(parseScalar('42')).toBe(42);
    expect(parseScalar('-1.5e3')).toBe(-1500);
  });

  it('leaves what merely looks like another type as the text it is', () => {
    // A date, a "yes", a version and a padded number are all words somebody wrote.
    for (const said of ['yes', 'no', 'on', '2026-09-06', '1.2.3', '007', 'Infinity', '0x10']) {
      expect(parseScalar(said), said).toBe(said);
    }
  });

  it('reads a quoted value as its text, quotes and all removed', () => {
    expect(parseScalar('"needs review"')).toBe('needs review');
    expect(parseScalar('"true"')).toBe('true');
  });
});

describe('writing a scalar', () => {
  it('quotes anything that would read back as something else', () => {
    expect(writeScalar('draft')).toBe('draft');
    expect(writeScalar('true')).toBe('"true"');
    expect(writeScalar('42')).toBe('"42"');
    expect(writeScalar('null')).toBe('"null"');
    expect(writeScalar('')).toBe('""');
    expect(writeScalar('needs: review')).toBe('"needs: review"');
    expect(writeScalar('[draft]')).toBe('"[draft]"');
    expect(writeScalar(true)).toBe('true');
    expect(writeScalar(null)).toBe('null');
    expect(writeScalar(3)).toBe('3');
  });

  it('round-trips every value it writes', () => {
    for (const value of ['draft', 'true', '42', '', 'needs: review', '[a, b]', ' padded ', '#tagged', 'yes']) {
      expect(parseScalar(writeScalar(value)), JSON.stringify(value)).toBe(value);
    }
    expect(isPlain('draft')).toBe(true);
    expect(isPlain('true')).toBe(false);
  });

  it('writes a new list as indented items and an empty one in brackets', () => {
    expect(writeProperty('people', ['Sam', 'Alex'])).toEqual(['people:', '  - Sam', '  - Alex']);
    expect(writeProperty('people', ['Sam'], 'inline')).toEqual(['people: [Sam]']);
    expect(writeProperty('people', [])).toEqual(['people: []']);
  });
});

describe('front matter as spans', () => {
  const text = [
    '---',
    'id: abc',
    '# a comment about this note',
    'status: draft',
    'people:',
    '  - Sam',
    '  - Alex',
    'config:',
    '  nested: true',
    '  deeper: 2',
    'created: 1970-01-01T00:00:01.000Z',
    'updated: 1970-01-01T00:00:02.000Z',
    'weird: !!str tagged',
    '---',
    'body',
    '',
  ].join('\n');

  it('reads properties, keeping a comment and a nested value as the lines they were', () => {
    const parsed = parseNoteFile(text, facts);
    expect(propertiesOf(parsed.frontMatter)).toEqual([
      { key: 'status', value: 'draft', occurrence: 1, complex: false },
      { key: 'people', value: ['Sam', 'Alex'], occurrence: 1, complex: false },
      { key: 'config', value: null, occurrence: 1, complex: true },
      { key: 'weird', value: null, occurrence: 1, complex: true },
    ]);
    expect(theirs(parsed.frontMatter)[0].source).toEqual(['# a comment about this note']);
    expect(parsed.frontMatter.find((e) => e.key === 'config')?.source).toEqual(['config:', '  nested: true', '  deeper: 2']);
  });

  it('writes back every untouched span byte for byte', () => {
    const parsed = parseNoteFile(text, facts);
    const again = formatNoteFile(parsed.note, parsed.frontMatter);
    for (const line of ['# a comment about this note', 'status: draft', 'config:', '  nested: true', 'weird: !!str tagged']) {
      expect(again, line).toContain(`\n${line}\n`);
    }
    expect(parseNoteFile(again, facts).frontMatter).toEqual(parsed.frontMatter);
  });

  it('changes one property and leaves its neighbours exactly as they were', () => {
    const parsed = parseNoteFile(text, facts);
    const next = withProperty(parsed.frontMatter, 'status', 'final');
    const written = formatNoteFile(parsed.note, next);
    expect(written).toContain('status: final');
    expect(written).toContain('# a comment about this note');
    expect(written).toContain('  nested: true');
    expect(written).toContain('weird: !!str tagged');
    // The order it had is the order it keeps: nothing is sorted and nothing moves.
    expect(next.map((e) => e.key ?? e.owned)).toEqual(parsed.frontMatter.map((e) => e.key ?? e.owned));
  });

  it('adds a new property after the last one, and takes one out on its own', () => {
    const parsed = parseNoteFile(text, facts);
    const added = withProperty(parsed.frontMatter, 'rating', 4);
    expect(added[added.length - 1]).toMatchObject({ key: 'rating', value: 4 });
    expect(added.find((e) => e.key === 'rating')?.source).toEqual(['rating: 4']);
    const gone = withProperty(parsed.frontMatter, 'status', undefined);
    expect(gone.some((e) => e.key === 'status')).toBe(false);
    expect(gone.some((e) => e.source[0] === '# a comment about this note')).toBe(true);
    expect(gone.find((e) => e.key === 'config')?.source).toHaveLength(3);
  });

  it('keeps a key written twice, and changes only the occurrence named', () => {
    const twice = parseNoteFile('---\nid: a\nstatus: draft\nstatus: final\n---\nbody\n', facts);
    expect(propertiesOf(twice.frontMatter)).toEqual([
      { key: 'status', value: 'draft', occurrence: 1, complex: false },
      { key: 'status', value: 'final', occurrence: 2, complex: false },
    ]);
    const changed = withProperty(twice.frontMatter, 'status', 'later', 2);
    expect(propertiesOf(changed).map((p) => p.value)).toEqual(['draft', 'later']);
    expect(propertiesOf(withoutProperty(twice.frontMatter, 'status'))).toEqual([]);
  });

  it('keeps a list written the way it was written', () => {
    const inline = parseNoteFile('---\nid: a\npeople: [Sam, Alex]\n---\nb\n', facts);
    expect(theirs(withProperty(inline.frontMatter, 'people', ['Sam', 'Kit']))[0].source).toEqual(['people: [Sam, Kit]']);
    const block = parseNoteFile('---\nid: a\npeople:\n  - Sam\n---\nb\n', facts);
    expect(theirs(withProperty(block.frontMatter, 'people', ['Sam', 'Kit']))[0].source).toEqual(['people:', '  - Sam', '  - Kit']);
  });

  it('carries the note’s own fields on unchanged, and does not make them properties', () => {
    const parsed = parseNoteFile('---\nid: a\ntitle: "Plan"\naliases: [P]\npinned: true\nstatus: draft\n---\nb\n', facts);
    expect(propertiesOf(parsed.frontMatter).map((p) => p.key)).toEqual(['status']);
    expect(parsed.note.aliases).toEqual(['P']);
    expect(parsed.note.pinned).toBe(true);
  });

  it('puts the properties on the note it parsed', () => {
    expect(parseNoteFile('---\nid: a\nstatus: draft\n---\nb\n', facts).note.properties).toEqual([{ key: 'status', value: 'draft', occurrence: 1, complex: false }]);
    expect(parseNoteFile('---\nid: a\n---\nb\n', facts).note.properties).toBeUndefined();
  });
});

describe('matching a property', () => {
  const prop = (value: unknown) => ({ key: 'k', value: value as never, occurrence: 1, complex: false });

  it('compares a whole value, never a part of one', () => {
    expect(propertyHas(prop('draft'), 'draft')).toBe(true);
    expect(propertyHas(prop('DRAFT'), 'draft')).toBe(true);
    expect(propertyHas(prop('final draft'), 'draft')).toBe(false);
  });

  it('lets a list match any of its items, and keeps types apart', () => {
    expect(propertyHas(prop(['work', 'urgent']), 'urgent')).toBe(true);
    expect(propertyHas(prop(['work']), 'urgent')).toBe(false);
    expect(propertyHas(prop(true), 'true')).toBe(false);
    expect(propertyHas(prop(3), 3)).toBe(true);
    expect(propertyHas({ ...prop('x'), complex: true }, 'x')).toBe(false);
  });

  it('reads a typed value the same conservative way', () => {
    expect(parseTyped('true')).toBe(true);
    expect(parseTyped('yes')).toBe('yes');
    expect(typeOfValue(['a'])).toBe('list');
    expect(typeOfValue(null, true)).toBe('complex');
  });
});
