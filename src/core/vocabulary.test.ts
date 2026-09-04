import { describe, expect, it } from 'vitest';
import { applyFilter, parseProp, parseQuery, parseWords } from './query';
import { completeKey, propertyVocabulary } from './vocabulary';
import type { NoteProperty } from '../shared/properties';
import type { Note } from '../shared/types';

const prop = (key: string, value: NoteProperty['value'], occurrence = 1, complex = false): NoteProperty => ({ key, value, occurrence, complex });

const note = (id: string, properties: NoteProperty[]): Note => ({ id, body: id, createdAt: 1, updatedAt: 1, properties });

const notes: Note[] = [
  note('a', [prop('status', 'draft'), prop('people', ['Sam', 'Alex'])]),
  note('b', [prop('status', 'draft'), prop('rating', 4)]),
  note('c', [prop('status', 'final'), prop('Status', 'shouted')]),
  note('d', [prop('status', 'draft', 1), prop('status', 'final', 2)]),
  note('e', [prop('config', null, 1, true)]),
  { id: 'f', body: 'no front matter at all', createdAt: 1, updatedAt: 1 },
];

describe('prop: in the search grammar', () => {
  it('finds notes carrying a key, and notes holding a value', () => {
    expect(applyFilter(notes, parseQuery('prop:status')).map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(applyFilter(notes, parseQuery('prop:status=draft')).map((n) => n.id).sort()).toEqual(['a', 'b', 'd']);
    expect(applyFilter(notes, parseQuery('prop:rating=4')).map((n) => n.id)).toEqual(['b']);
  });

  it('lets a list match any of its items and compares a whole value', () => {
    expect(applyFilter(notes, parseQuery('prop:people=Alex')).map((n) => n.id)).toEqual(['a']);
    expect(applyFilter(notes, parseQuery('prop:people=Al')).map((n) => n.id)).toEqual([]);
    expect(applyFilter(notes, parseQuery('prop:status=DRAFT')).map((n) => n.id).sort()).toEqual(['a', 'b', 'd']);
  });

  it('keeps a key’s case, because YAML does', () => {
    expect(applyFilter(notes, parseQuery('prop:Status')).map((n) => n.id)).toEqual(['c']);
  });

  it('turns around with a leading minus', () => {
    expect(applyFilter(notes, parseQuery('-prop:status')).map((n) => n.id).sort()).toEqual(['e', 'f']);
    expect(applyFilter(notes, parseQuery('-prop:status=draft')).map((n) => n.id).sort()).toEqual(['c', 'e', 'f']);
  });

  it('answers a key written twice from any of its occurrences', () => {
    expect(applyFilter(notes, parseQuery('prop:status=final')).map((n) => n.id).sort()).toEqual(['c', 'd']);
  });

  it('finds a complex value by its key but never by a value', () => {
    expect(applyFilter(notes, parseQuery('prop:config')).map((n) => n.id)).toEqual(['e']);
    expect(applyFilter(notes, parseQuery('prop:config=anything')).map((n) => n.id)).toEqual([]);
  });

  it('says it cannot compare rather than hunting for a key spelled with a >', () => {
    const asked = parseQuery('prop:rating>3');
    expect(asked.errors[0]).toContain('prop:');
    expect(asked.props).toBeUndefined();
  });

  it('takes a quoted operand, for a key or value with a space in it', () => {
    const filter = parseQuery('prop:"review status=needs review"');
    expect(filter.props).toEqual([{ key: 'review status', value: 'needs review' }]);
  });

  it('reads the same on the command line, one argv word at a time', () => {
    expect(applyFilter(notes, parseWords(['prop:status=draft'])).map((n) => n.id).sort()).toEqual(['a', 'b', 'd']);
    expect(parseWords(['prop:status', 'prop:rating=4']).props).toHaveLength(2);
  });

  it('reads an operand as a key and an optional value', () => {
    expect(parseProp('status')).toEqual({ key: 'status' });
    expect(parseProp('status=draft')).toEqual({ key: 'status', value: 'draft' });
    expect(parseProp('done=true')).toEqual({ key: 'done', value: true });
    expect(parseProp('')).toBe(null);
  });
});

describe('propertyVocabulary', () => {
  it('counts the notes carrying each key, commonest first', () => {
    const vocabulary = propertyVocabulary(notes);
    expect(vocabulary.map((u) => [u.key, u.noteCount])).toEqual([
      ['status', 4],
      ['config', 1],
      ['people', 1],
      ['rating', 1],
      ['Status', 1],
    ]);
  });

  it('lists casing variants rather than merging them', () => {
    const vocabulary = propertyVocabulary(notes);
    expect(vocabulary.find((u) => u.key === 'status')?.casingVariants).toEqual(['Status']);
    expect(vocabulary.find((u) => u.key === 'Status')?.casingVariants).toEqual(['status']);
  });

  it('reports what shapes a key’s value takes, and where it is written twice', () => {
    const vocabulary = propertyVocabulary(notes);
    expect(vocabulary.find((u) => u.key === 'status')?.duplicateCount).toBe(1);
    expect(vocabulary.find((u) => u.key === 'rating')?.types).toEqual(['number']);
    expect(vocabulary.find((u) => u.key === 'config')?.types).toEqual(['complex']);
  });

  it('lists a key’s distinct values, a list item at a time, commonest first', () => {
    const vocabulary = propertyVocabulary(notes);
    expect(vocabulary.find((u) => u.key === 'status')?.values).toEqual([
      { text: 'draft', value: 'draft', noteCount: 3 },
      { text: 'final', value: 'final', noteCount: 2 },
    ]);
    expect(vocabulary.find((u) => u.key === 'people')?.values.map((v) => v.text)).toEqual(['Alex', 'Sam']);
    // A complex value is counted but never enumerated: its YAML is not something to search for.
    expect(vocabulary.find((u) => u.key === 'config')?.values).toEqual([]);
  });
});

describe('completeKey', () => {
  it('offers what the notebook already calls things, prefixes first', () => {
    const vocabulary = propertyVocabulary(notes);
    expect(completeKey(vocabulary, 'sta').map((u) => u.key)).toEqual(['status', 'Status']);
    expect(completeKey(vocabulary, 'ating').map((u) => u.key)).toEqual(['rating']);
    expect(completeKey(vocabulary, 'nothing')).toEqual([]);
    expect(completeKey(vocabulary, '').length).toBe(5);
  });
});
