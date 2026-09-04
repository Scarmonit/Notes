import { describe, expect, it } from 'vitest';
import { DEFAULT_JOURNAL_PATH, isoDate, journalNoteAt, journalPathError, journalPlace, momentOf, parseJournalDate } from './journal';
import { expandTemplate } from './templates';
import type { Note } from '../shared/types';

// A Sunday, so the weekday arithmetic has somewhere to count from.
const now = new Date(2026, 8, 6, 15, 30);

describe('parseJournalDate', () => {
  it('reads the words for a day', () => {
    expect(isoDate(parseJournalDate('', now)!)).toBe('2026-09-06');
    expect(isoDate(parseJournalDate('today', now)!)).toBe('2026-09-06');
    expect(isoDate(parseJournalDate('yesterday', now)!)).toBe('2026-09-05');
    expect(isoDate(parseJournalDate('TOMORROW', now)!)).toBe('2026-09-07');
  });

  it('reads offsets and weekdays', () => {
    expect(isoDate(parseJournalDate('+3d', now)!)).toBe('2026-09-09');
    expect(isoDate(parseJournalDate('-2', now)!)).toBe('2026-09-04');
    expect(isoDate(parseJournalDate('+1w', now)!)).toBe('2026-09-13');
    expect(isoDate(parseJournalDate('-1m', now)!)).toBe('2026-08-06');
    // The next Friday there is; and today, when today is the day named.
    expect(isoDate(parseJournalDate('fri', now)!)).toBe('2026-09-11');
    expect(isoDate(parseJournalDate('sunday', now)!)).toBe('2026-09-06');
  });

  it('reads an ISO date and refuses one nobody has', () => {
    expect(isoDate(parseJournalDate('2026-01-31', now)!)).toBe('2026-01-31');
    expect(parseJournalDate('2026-02-30', now)).toBe(null);
    expect(parseJournalDate('2026-13-01', now)).toBe(null);
  });

  it('refuses a time: this asks which day, not which moment', () => {
    expect(parseJournalDate('16:00', now)).toBe(null);
    expect(parseJournalDate('9am', now)).toBe(null);
    expect(parseJournalDate('next thursday-ish', now)).toBe(null);
  });
});

describe('journalPlace', () => {
  it('makes a folder out of every slash in the format', () => {
    const place = journalPlace({ year: 2026, month: 9, day: 6 }, DEFAULT_JOURNAL_PATH);
    expect(place).toEqual({ folder: 'Journal/2026', title: '2026-09-06', path: 'Journal/2026/2026-09-06' });
  });

  it('files at the root when the format has no folder in it', () => {
    expect(journalPlace({ year: 2026, month: 9, day: 6 }, 'YYYY-MM-DD')).toMatchObject({ folder: '', title: '2026-09-06' });
  });

  it('honours the format language, literals and all', () => {
    expect(journalPlace({ year: 2026, month: 9, day: 6 }, '[Daily]/YYYY/MMMM/DDD D').path).toBe('Daily/2026/September/Sun 6');
  });

  it('refuses a format that would step outside the notes folder or name nothing', () => {
    expect(journalPathError('Journal/YYYY/YYYY-MM-DD')).toBe(null);
    expect(journalPathError('[..]/YYYY')).toContain('outside');
    expect(journalPathError('[]')).toContain('empty');
    expect(journalPathError('Journal//YYYY')).toContain('empty folder');
    expect(journalPathError('Journal/YYYY:MM')).toContain('characters');
  });
});

describe('the date a template is expanded against', () => {
  it('is the entry’s own day, not the moment it was written', () => {
    const template = { body: 'Notes for {{date:DDDD D MMMM YYYY}}\n\n## {{date}}' };
    const back = expandTemplate(template, { now: momentOf({ year: 2026, month: 1, day: 3 }) });
    expect(back).toContain('Notes for Saturday 3 January 2026');
    expect(back).toContain('## 2026-01-03');
  });

  it('is local noon, so a clock change cannot move the day', () => {
    const at = momentOf({ year: 2026, month: 3, day: 8 });
    expect(at.getHours()).toBe(12);
    expect(at.getDate()).toBe(8);
  });
});

describe('journalNoteAt', () => {
  const note = (id: string, folder: string, file: string, title: string): Note => ({ id, body: '', createdAt: 1, updatedAt: 1, folder, file, title });

  it('finds the note occupying the path, whatever it is called inside', () => {
    const place = journalPlace({ year: 2026, month: 9, day: 6 });
    const notes = [note('a', 'Journal/2026', '2026-09-06.md', 'Something else entirely'), note('b', '', '2026-09-06.md', '2026-09-06')];
    expect(journalNoteAt(notes, place)?.id).toBe('a');
    expect(journalNoteAt([notes[1]], place)).toBe(null);
  });

  it('falls back to the title when the file was numbered aside', () => {
    const place = journalPlace({ year: 2026, month: 9, day: 6 });
    expect(journalNoteAt([note('c', 'Journal/2026', '2026-09-06 2.md', '2026-09-06')], place)?.id).toBe('c');
  });
});
