import { describe, expect, it } from 'vitest';
import { fileNameFor, formatNoteFile, isNoteFileName, parseNoteFile, uniqueFileName } from './notes-folder';
import type { Note } from './types';

const facts = { id: 'fallback-id', name: 'Dropped file', mtime: 5000 };

describe('formatNoteFile / parseNoteFile', () => {
  it('round-trips a note through the file text', () => {
    const note: Note = { id: 'abc', body: 'first line\n\nsecond **para**', createdAt: 1000, updatedAt: 2000, pinned: true, title: 'Plan: today' };
    const text = formatNoteFile(note);
    expect(text.startsWith('---\nid: abc\n')).toBe(true);
    expect(parseNoteFile(text, facts)).toMatchObject({ note, extra: [], needsWrite: false });
  });

  it('keeps a body that ends in a newline, and one that is empty', () => {
    const ends: Note = { id: 'a', body: 'trailing\n', createdAt: 1, updatedAt: 1 };
    expect(parseNoteFile(formatNoteFile(ends), facts).note.body).toBe('trailing\n');
    const empty: Note = { id: 'a', body: '', createdAt: 1, updatedAt: 1 };
    expect(parseNoteFile(formatNoteFile(empty), facts).note.body).toBe('');
  });

  it('keeps a body that itself starts with a rule', () => {
    const note: Note = { id: 'a', body: '---\nunder a rule', createdAt: 1, updatedAt: 1 };
    expect(parseNoteFile(formatNoteFile(note), facts).note.body).toBe('---\nunder a rule');
  });

  it('carries front-matter lines it does not understand through a rewrite', () => {
    const text = '---\nid: abc\ntags: [wow, commands]\ncreated: 1970-01-01T00:00:01.000Z\nupdated: 1970-01-01T00:00:02.000Z\nsource: somewhere\n---\nbody\n';
    const parsed = parseNoteFile(text, facts);
    expect(parsed.extra).toEqual(['tags: [wow, commands]', 'source: somewhere']);
    const again = parseNoteFile(formatNoteFile(parsed.note, parsed.extra), facts);
    expect(again.extra).toEqual(parsed.extra);
    expect(again.note).toEqual(parsed.note);
  });

  it('reads aliases written as a YAML block, as Obsidian writes them', () => {
    const text = '---\nid: abc\naliases:\n  - Doggo\n  - "Woofer, the"\ncreated: 1970-01-01T00:00:01.000Z\nupdated: 1970-01-01T00:00:02.000Z\n---\nbody\n';
    const parsed = parseNoteFile(text, facts);
    expect(parsed.note.aliases).toEqual(['Doggo', 'Woofer, the']);
    expect(parsed.extra).toEqual([]);
  });

  it('reads aliases written on one line, in brackets or without', () => {
    const one = parseNoteFile('---\nid: a\naliases: [Doggo, Woofer]\n---\nbody\n', facts);
    expect(one.note.aliases).toEqual(['Doggo', 'Woofer']);
    const bare = parseNoteFile('---\nid: a\naliases: Doggo, Woofer\n---\nbody\n', facts);
    expect(bare.note.aliases).toEqual(['Doggo', 'Woofer']);
  });

  it('writes aliases back on one line, quoting only what needs it', () => {
    const note: Note = { id: 'a', body: 'b', createdAt: 1, updatedAt: 2, aliases: ['Doggo', 'Woofer, the'] };
    const text = formatNoteFile(note);
    expect(text).toContain('aliases: [Doggo, "Woofer, the"]');
    expect(parseNoteFile(text, facts).note.aliases).toEqual(['Doggo', 'Woofer, the']);
  });

  it('drops blank and repeated aliases rather than storing them', () => {
    const parsed = parseNoteFile('---\nid: a\naliases: [Doggo, , doggo, Woofer]\n---\nbody\n', facts);
    expect(parsed.note.aliases).toEqual(['Doggo', 'Woofer']);
  });

  it('leaves a note with no aliases without the field at all', () => {
    const note: Note = { id: 'a', body: 'b', createdAt: 1, updatedAt: 2 };
    expect(formatNoteFile(note)).not.toContain('aliases');
    expect(parseNoteFile(formatNoteFile(note), facts).note.aliases).toBeUndefined();
  });

  it('reads a plain markdown file as a note titled by its filename, dated by the file', () => {
    const parsed = parseNoteFile('# Hello\n\nDropped in by hand.\n', facts);
    expect(parsed.note).toEqual({ id: 'fallback-id', body: '# Hello\n\nDropped in by hand.', createdAt: 5000, updatedAt: 5000, title: 'Dropped file' });
    expect(parsed.needsWrite).toBe(true);
  });

  it('asks for a rewrite when the front matter has no id, but keeps the rest of it', () => {
    const parsed = parseNoteFile('---\ntitle: Kept\npinned: true\n---\nbody\n', facts);
    expect(parsed.note).toMatchObject({ id: 'fallback-id', title: 'Kept', pinned: true, body: 'body' });
    expect(parsed.needsWrite).toBe(true);
  });

  it('accepts Windows line endings and single-quoted titles', () => {
    const parsed = parseNoteFile("---\r\nid: x\r\ntitle: 'It''s here'\r\n---\r\nline one\r\nline two\r\n", facts);
    expect(parsed.note.title).toBe("It's here");
    expect(parsed.note.body).toBe('line one\nline two');
  });

  it('reads dates written as milliseconds as well as ISO text', () => {
    const parsed = parseNoteFile('---\nid: x\ncreated: 1234\nupdated: not a date\n---\n', facts);
    expect(parsed.note.createdAt).toBe(1234);
    expect(parsed.note.updatedAt).toBe(5000);
  });

  it('takes a number past what a date can hold for no date, so the file can be written back', () => {
    // Nanoseconds from another tool: a Date cannot hold them, and formatting one would throw on every save.
    const parsed = parseNoteFile('---\nid: x\ncreated: 1756908000000000000\n---\nwords\n', facts);
    expect(parsed.note.createdAt).toBe(5000);
    expect(() => formatNoteFile(parsed.note, parsed.extra)).not.toThrow();
  });

  it('records a deletion time when the file is in the trash', () => {
    const note: Note = { id: 'a', body: 'gone', createdAt: 1, updatedAt: 2 };
    const parsed = parseNoteFile(formatNoteFile(note, [], 90_000), facts);
    expect(parsed.deletedAt).toBe(90_000);
    expect(parsed.note).toEqual(note);
    expect(parseNoteFile(formatNoteFile(note), facts).deletedAt).toBeUndefined();
  });
});

describe('fileNameFor', () => {
  it('keeps spaces and drops what Windows forbids', () => {
    expect(fileNameFor('WOW PRIVATE SERVER - COMMANDS')).toBe('WOW PRIVATE SERVER - COMMANDS');
    expect(fileNameFor('Plan: today? *yes*')).toBe('Plan today yes');
    expect(fileNameFor('a/b\\c<d>e|f"g')).toBe('a b c d e f g');
  });
  it('falls back to Untitled', () => {
    expect(fileNameFor('')).toBe('Untitled');
    expect(fileNameFor('...')).toBe('Untitled');
    expect(fileNameFor('CON')).toBe('Untitled');
  });
  it('cuts long titles', () => {
    expect(fileNameFor('x'.repeat(200)).length).toBe(80);
  });
});

describe('uniqueFileName', () => {
  it('numbers from 2 until a name is free', () => {
    const taken = new Set(['Plan.md', 'Plan 2.md']);
    expect(uniqueFileName('Plan', (n) => taken.has(n))).toBe('Plan 3.md');
    expect(uniqueFileName('Other', (n) => taken.has(n))).toBe('Other.md');
  });
});

describe('isNoteFileName', () => {
  it('takes .md files and leaves temp and hidden files alone', () => {
    expect(isNoteFileName('Plan.md')).toBe(true);
    expect(isNoteFileName('PLAN.MD')).toBe(true);
    expect(isNoteFileName('Plan.md.tmp')).toBe(false);
    expect(isNoteFileName('.sync.md')).toBe(false);
    expect(isNoteFileName('~$Plan.md')).toBe(false);
    expect(isNoteFileName('readme.txt')).toBe(false);
  });
});

describe('fileNameFor and isNoteFileName agree', () => {
  it('never makes a name the store would take for a hidden or lock file', () => {
    // A leading dot or tilde is what isNoteFileName rejects: the note was written and never read again.
    for (const title of ['.env cheatsheet', '~tilde title', '..', '~', '. .', '~/.config notes']) {
      const name = `${fileNameFor(title)}.md`;
      expect(isNoteFileName(name), `${JSON.stringify(title)} -> ${name}`).toBe(true);
    }
    expect(fileNameFor('.env cheatsheet')).toBe('env cheatsheet');
    expect(fileNameFor('..')).toBe('Untitled');
  });
});
