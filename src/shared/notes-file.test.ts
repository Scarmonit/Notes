import { describe, expect, it } from 'vitest';
import { parseNotesFile } from './notes-file';

const good = { id: 'a', body: 'hi', createdAt: 1, updatedAt: 2 };

describe('parseNotesFile', () => {
  it('round-trips a valid file', () => {
    const text = JSON.stringify({ version: 1, notes: [good] });
    expect(parseNotesFile(text)).toEqual({ version: 1, notes: [good] });
  });

  it('drops malformed and duplicate entries but keeps the rest', () => {
    const text = JSON.stringify({
      version: 1,
      notes: [good, { id: 'b' }, null, 'x', { ...good, id: 'a' }, { ...good, id: 'c', updatedAt: 'later' }],
    });
    expect(parseNotesFile(text).notes.map((n) => n.id)).toEqual(['a']);
  });

  it('ignores unknown fields on a note', () => {
    const text = JSON.stringify({ version: 1, notes: [{ ...good, extra: true }] });
    expect(parseNotesFile(text).notes[0]).toEqual(good);
  });

  it('rejects documents that are not a notes file', () => {
    expect(() => parseNotesFile('null')).toThrow();
    expect(() => parseNotesFile('[]')).toThrow();
    expect(() => parseNotesFile('{"version":2,"notes":[]}')).toThrow();
    expect(() => parseNotesFile('{"version":1}')).toThrow();
    expect(() => parseNotesFile('not json')).toThrow();
  });
});
