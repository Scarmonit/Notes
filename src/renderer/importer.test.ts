import { describe, expect, it } from 'vitest';
import { isTextFile, noteFromFile } from './importer';

describe('isTextFile', () => {
  it('takes markdown and text, whatever the case', () => {
    for (const name of ['notes.md', 'Read Me.MARKDOWN', 'a.mkd', 'log.txt', 'x.TEXT']) {
      expect(isTextFile(name)).toBe(true);
    }
  });

  it('leaves anything else alone', () => {
    for (const name of ['photo.png', 'sheet.csv', 'notes', 'notes.md.exe']) {
      expect(isTextFile(name)).toBe(false);
    }
  });
});

describe('noteFromFile', () => {
  it('lifts a leading heading out as the title, the way export writes it', () => {
    expect(noteFromFile('whatever.md', '# Garden plans\n\nDig the bed.\nPlant peas.')).toEqual({
      title: 'Garden plans',
      body: 'Dig the bed.\nPlant peas.',
    });
  });

  it('round-trips a note the app exported', () => {
    const exported = '# Shopping\n\n- [ ] bread\n- [x] milk';
    const back = noteFromFile('Shopping.md', exported);
    expect(back.title).toBe('Shopping');
    expect(back.body).toBe('- [ ] bread\n- [x] milk');
  });

  it('falls back to the file name when there is no heading', () => {
    expect(noteFromFile('C:\\notes\\Meeting notes.txt', 'said this\nsaid that')).toEqual({
      title: 'Meeting notes',
      body: 'said this\nsaid that',
    });
  });

  it('only lifts a real heading, not a tag or a deeper one', () => {
    expect(noteFromFile('x.md', '#tag at the top\n\nbody').title).toBe('x');
    expect(noteFromFile('x.md', '## Sub\n\nbody').title).toBe('x');
  });

  it('normalises Windows line endings and a byte order mark', () => {
    expect(noteFromFile('x.md', '\ufeff# T\r\n\r\none\r\ntwo')).toEqual({ title: 'T', body: 'one\ntwo' });
  });

  it('handles a file that is only a heading', () => {
    expect(noteFromFile('x.md', '# Just this')).toEqual({ title: 'Just this', body: '' });
  });

  it('handles an empty file', () => {
    expect(noteFromFile('Empty.txt', '')).toEqual({ title: 'Empty', body: '' });
  });
});
