import { describe, expect, it } from 'vitest';
import { linkMention, unlinkedMentions } from './mentions';
import type { Note } from '../shared/types';

const note = (id: string, title: string, body: string, aliases?: string[]): Note => ({
  id,
  title,
  body,
  createdAt: 1,
  updatedAt: 1,
  ...(aliases ? { aliases } : {}),
});

describe('unlinkedMentions', () => {
  it('finds a note that says the name in plain words', () => {
    const notes = [note('a', 'Kitchen rebuild', ''), note('b', 'Plans', 'The Kitchen rebuild starts in May.')];
    const found = unlinkedMentions(notes, 'a');
    expect(found.map((m) => m.note.id)).toEqual(['b']);
    expect(found[0].name).toBe('Kitchen rebuild');
    expect(found[0].text).toBe('The Kitchen rebuild starts in May.');
  });

  it('leaves out a note that already links here: that is a backlink', () => {
    const notes = [note('a', 'Kitchen rebuild', ''), note('b', 'Plans', 'See [[Kitchen rebuild]] — the Kitchen rebuild starts in May.')];
    expect(unlinkedMentions(notes, 'a')).toEqual([]);
  });

  it('ignores the name inside a link, a fence, inline code or a URL', () => {
    const notes = [
      note('a', 'Plans', ''),
      note('b', 'Elsewhere', '[[Other|Plans]]\n\n`Plans`\n\n```\nPlans\n```\n\nhttps://example.com/Plans'),
    ];
    expect(unlinkedMentions(notes, 'a')).toEqual([]);
  });

  it('matches whole words only, and ignores capitals', () => {
    const notes = [note('a', 'Plan', ''), note('b', 'Other', 'Planning is not a plan, but the plan is.')];
    const found = unlinkedMentions(notes, 'a');
    expect(found).toHaveLength(1);
    expect(found[0].note.body.slice(found[0].start, found[0].end)).toBe('plan');
  });

  it('finds a mention of one of the note’s other names', () => {
    const notes = [note('a', 'Dog', '', ['Doggo']), note('b', 'Walks', 'Took Doggo out.')];
    const found = unlinkedMentions(notes, 'a');
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Doggo');
  });

  it('offers one mention per note, the first', () => {
    const notes = [note('a', 'Plan', ''), note('b', 'Other', 'a plan\n\nanother plan\n\na third plan')];
    const found = unlinkedMentions(notes, 'a');
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(0);
  });

  it('says nothing about a note with a very short or missing title', () => {
    expect(unlinkedMentions([note('a', 'Ab', ''), note('b', 'Other', 'Ab Ab Ab')], 'a')).toEqual([]);
    const untitled: Note = { id: 'a', body: '', createdAt: 1, updatedAt: 1 };
    expect(unlinkedMentions([untitled, note('b', 'Other', 'Untitled things')], 'a')).toEqual([]);
  });

  it('never offers the note itself', () => {
    expect(unlinkedMentions([note('a', 'Plan', 'This plan is about the plan.')], 'a')).toEqual([]);
  });
});

describe('linkMention', () => {
  it('turns the words into a link, keeping how they were written', () => {
    const target = note('a', 'Kitchen rebuild', '');
    const body = 'The kitchen rebuild starts in May.';
    // A link resolves case-insensitively, so a difference of capitals needs no alias.
    expect(linkMention(body, { start: 4, end: 19 }, target)).toBe('The [[kitchen rebuild]] starts in May.');
  });

  it('names the note and shows the words when they are one of its other names', () => {
    const target = note('a', 'Dog', '', ['Doggo']);
    expect(linkMention('Took Doggo out.', { start: 5, end: 10 }, target)).toBe('Took [[Dog|Doggo]] out.');
  });

  it('writes a plain link when the words are the title', () => {
    const target = note('a', 'Plan', '');
    expect(linkMention('A Plan here', { start: 2, end: 6 }, target)).toBe('A [[Plan]] here');
  });

  it('refuses a span with nothing in it', () => {
    expect(linkMention('abc', { start: 1, end: 1 }, note('a', 'Plan', ''))).toBeNull();
  });
});
