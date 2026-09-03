// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import { expandPlaceholders, expandTemplate, formatDate, isTemplate, templateNamed, templatesOf, withoutTemplateTag } from './templates';

const note = (id: string, body: string, title?: string): Note => ({ id, body, createdAt: 1, updatedAt: 1, ...(title ? { title } : {}) });
const at = new Date(2026, 8, 3, 14, 7, 9); // Thursday 3 September 2026, 14:07:09 local

describe('formatDate', () => {
  it('knows the usual tokens and keeps bracketed text', () => {
    expect(formatDate(at, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-09-03 14:07:09');
    expect(formatDate(at, 'DDDD D MMMM YYYY, h:mm a')).toBe('Thursday 3 September 2026, 2:07 pm');
    expect(formatDate(at, 'DDD DD MMM YY [at] hh A')).toBe('Thu 03 Sep 26 at 02 PM');
    expect(formatDate(at, 'M/D')).toBe('9/3');
  });
});

describe('expandPlaceholders', () => {
  it('fills title, date, time and formatted variants', () => {
    const text = '# {{title}}\n\n{{date}} {{time}} · {{date:DDD D MMM}} · {{ time:h:mm a }} · {{datetime}}';
    expect(expandPlaceholders(text, { title: 'Standup', now: at })).toBe('# Standup\n\n2026-09-03 14:07 · Thu 3 Sep · 2:07 pm · 2026-09-03 14:07');
  });
  it('leaves unknown placeholders alone and an absent title empty', () => {
    expect(expandPlaceholders('{{who}} {{title}}!', { now: at })).toBe('{{who}} !');
  });
});

describe('templates', () => {
  const notes = [
    note('a', 'plain note'),
    note('b', '# {{title}}\n\nAgenda\n\n#template #meeting', 'Meeting'),
    note('c', 'Dear {{title}},\n\n#template', 'Letter'),
    note('d', 'looks like #templates but is not one'),
  ];
  it('finds notes tagged #template, by title', () => {
    expect(notes.map(isTemplate)).toEqual([false, true, true, false]);
    expect(templatesOf(notes).map((n) => n.id)).toEqual(['c', 'b']);
    expect(templateNamed(notes, 'meeting')?.id).toBe('b');
    expect(templateNamed(notes, 'let')?.id).toBe('c');
    expect(templateNamed(notes, 'plain')).toBeNull();
  });
  it('expands a template into a body without the tag', () => {
    expect(withoutTemplateTag('#template\n\nBody\n\ntags #a #template #b')).toBe('Body\n\ntags #a #b');
    expect(expandTemplate(notes[1], { title: 'Sync', now: at })).toBe('# Sync\n\nAgenda\n\n#meeting');
    expect(expandTemplate(notes[2], { title: 'Ada', now: at })).toBe('Dear Ada,');
  });
});
