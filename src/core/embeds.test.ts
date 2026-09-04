import { describe, expect, it } from 'vitest';
import { embedsFrom } from './embeds';
import { parseMarkdown } from '../shared/markdown-core';
import type { Note } from '../shared/types';

const note = (id: string, title: string, body: string, aliases?: string[]): Note => ({
  id,
  title,
  body,
  createdAt: 1,
  updatedAt: 1,
  ...(aliases ? { aliases } : {}),
});

const render = (source: string, notes: Note[]): string => parseMarkdown(source, embedsFrom(notes));

describe('embeds', () => {
  const notes = [
    note('a', 'Plans', '# Plans\n\nThe first line.\n\n## Order\n\n- worktop\n\n### Later\n\nMuch later.\n\n## Money\n\nNone.'),
    note('b', 'Dog', 'Woof.', ['Doggo']),
  ];

  it('puts a whole note in the place of the embed', () => {
    const html = render('Before\n\n![[Plans]]\n\nAfter', notes);
    expect(html).toContain('The first line.');
    expect(html).toContain('class="embed"');
    expect(html).toContain('Before');
    expect(html).toContain('After');
  });

  it('puts just one section in, subsections and all, and stops at the next heading of its level', () => {
    const html = render('![[Plans#Order]]', notes);
    expect(html).toContain('worktop');
    expect(html).toContain('Much later.');
    expect(html).not.toContain('None.');
    expect(html).not.toContain('The first line.');
  });

  it('resolves the target the way a link does, aliases included', () => {
    expect(render('![[Doggo]]', notes)).toContain('Woof.');
  });

  it('says so plainly when there is no such note or no such heading', () => {
    expect(render('![[Nowhere]]', notes)).toContain('No note called that');
    expect(render('![[Plans#Nothing]]', notes)).toContain('No note called that');
  });

  it('refuses to follow a note that embeds itself, or two that embed each other', () => {
    const loop = [note('a', 'A', 'top\n\n![[B]]'), note('b', 'B', 'bottom\n\n![[A]]')];
    const html = render('![[A]]', loop);
    expect(html).toContain('top');
    expect(html).toContain('bottom');
    expect(html).toContain('That note embeds this one');
  });

  it('is a block: an embed in the middle of a sentence stays the characters typed', () => {
    const html = render('See ![[Plans]] there', notes);
    expect(html).not.toContain('class="embed"');
    expect(html).toContain('Plans');
  });

  it('leaves an embed inside a code fence alone', () => {
    const html = render('```\n![[Plans]]\n```', notes);
    expect(html).not.toContain('class="embed"');
    expect(html).toContain('![[Plans]]');
  });

  it('draws an empty embed when there is no notebook to read', () => {
    expect(parseMarkdown('![[Plans]]')).toContain('No note called that');
  });

  it('still renders the ordinary link on the same page', () => {
    const html = render('![[Plans]]\n\nand [[Dog]]', notes);
    expect(html).toContain('class="embed"');
    expect(html).toContain('data-link="Dog"');
  });
});
