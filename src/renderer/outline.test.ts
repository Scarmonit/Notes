import { describe, expect, it } from 'vitest';
import { headingAt, headingsIn, sectionOf } from './outline';

describe('headingsIn', () => {
  it('lists ATX headings with their level and line', () => {
    const body = 'intro\n# One\ntext\n## Two **bold**\n### Three ###\n#### Four';
    expect(headingsIn(body)).toEqual([
      { level: 1, text: 'One', line: 1 },
      { level: 2, text: 'Two bold', line: 3 },
      { level: 3, text: 'Three', line: 4 },
      { level: 4, text: 'Four', line: 5 },
    ]);
  });

  it('ignores # lines inside code fences, tags and empty headings', () => {
    const body = '#tag only\n```\n# not a heading\n```\n# Real\n#\n####### seven';
    expect(headingsIn(body)).toEqual([{ level: 1, text: 'Real', line: 4 }]);
  });

  it('is empty for a note without headings', () => {
    expect(headingsIn('')).toEqual([]);
    expect(headingsIn('just words\n---\nmore')).toEqual([]);
  });
});

describe('headingAt', () => {
  const hs = headingsIn('# A\nx\n# B\ny\n# C');
  it('finds the heading a line falls under', () => {
    expect(headingAt(hs, 0)).toBe(0);
    expect(headingAt(hs, 1)).toBe(0);
    expect(headingAt(hs, 3)).toBe(1);
    expect(headingAt(hs, 9)).toBe(2);
  });
  it('is -1 above the first heading', () => {
    expect(headingAt(headingsIn('x\n# A'), 0)).toBe(-1);
    expect(headingAt([], 3)).toBe(-1);
  });
});

describe('headings that end in #', () => {
  it('keeps a # that is part of the last word and drops only a spaced closing run', () => {
    expect(headingsIn('# C#\n## Learning F#\n### Three ###\n#### Four #').map((h) => h.text)).toEqual(['C#', 'Learning F#', 'Three', 'Four']);
  });
});

describe('sectionOf', () => {
  const body = '# Top\n\nintro\n\n## Plans\n\nfirst\n\n### Later\n\nmuch later\n\n## Money\n\nnone';

  it('takes a heading and everything under it, subsections included', () => {
    expect(sectionOf(body, 'Plans')).toBe('## Plans\n\nfirst\n\n### Later\n\nmuch later');
  });

  it('stops at the next heading of the same level or above', () => {
    expect(sectionOf(body, 'Later')).toBe('### Later\n\nmuch later');
    expect(sectionOf(body, 'Money')).toBe('## Money\n\nnone');
  });

  it('reads the last section to the end of the note', () => {
    expect(sectionOf('# One\n\na\n\n# Two\n\nb', 'Two')).toBe('# Two\n\nb');
  });

  it('is nothing when no heading says that', () => {
    expect(sectionOf(body, 'Nowhere')).toBeNull();
  });

  it('ignores capitals and stray spaces, as a link does', () => {
    expect(sectionOf(body, '  plans ')).toBe('## Plans\n\nfirst\n\n### Later\n\nmuch later');
  });
});
