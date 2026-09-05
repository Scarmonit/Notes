import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown-core';

describe('callouts', () => {
  it('draws a typed callout with its label and title', () => {
    const html = parseMarkdown('> [!info] Read this\n> The words.\n\nAfter.');
    expect(html).toContain('<div class="callout" data-callout="info">');
    expect(html).toContain('<span class="callout-label u">Info</span>');
    expect(html).toContain('<span class="callout-title">Read this</span>');
    expect(html).toMatch(/<div class="callout-body"><p>The words\.<\/p>\s*<\/div>/);
    expect(html).toContain('<p>After.</p>');
    expect(html).not.toContain('<blockquote>');
  });

  it('knows every alias and falls back to note for a kind nobody defined, keeping its name', () => {
    expect(parseMarkdown('> [!tldr]\n> x')).toContain('data-callout="abstract"');
    expect(parseMarkdown('> [!tldr]\n> x')).toContain('>Abstract<');
    expect(parseMarkdown('> [!CAUTION]\n> x')).toContain('data-callout="warning"');
    const odd = parseMarkdown('> [!foo]\n> x');
    expect(odd).toContain('data-callout="note"');
    expect(odd).toContain('>Foo<');
  });

  it('makes a foldable callout a details element, folded for - and open for +', () => {
    expect(parseMarkdown('> [!note]- Hidden\n> body')).toMatch(/<details class="callout" data-callout="note"><summary class="callout-head">/);
    expect(parseMarkdown('> [!note]+ Shown\n> body')).toContain('<details class="callout" data-callout="note" open>');
    expect(parseMarkdown('> [!note] Plain\n> body')).not.toContain('<details');
  });

  it('shows every callout open on paper', () => {
    const html = parseMarkdown('> [!note]- Hidden\n> body', undefined, { paper: true });
    expect(html).not.toContain('<details');
    expect(html).toContain('<div class="callout" data-callout="note">');
    expect(html).toContain('body');
  });

  it('nests a callout inside a callout', () => {
    const html = parseMarkdown('> [!question] Outer\n> > [!tip] Inner\n> > deep');
    expect(html.match(/class="callout"/g)).toHaveLength(2);
    expect(html).toContain('data-callout="tip"');
  });

  it('leaves an ordinary quote, and a callout written in a fence, alone', () => {
    expect(parseMarkdown('> just a quote')).toContain('<blockquote>');
    const fenced = parseMarkdown('```\n> [!info] no\n```');
    expect(fenced).not.toContain('callout');
    expect(fenced).toContain('&gt; [!info] no');
  });

  it('formats the title inline and escapes the label', () => {
    const html = parseMarkdown('> [!Weird<] **bold** title\n> x');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('Weird<<');
  });
});

describe('footnotes', () => {
  const note = 'One[^a] and two[^b] and one again[^a].\n\n[^a]: The first.\n[^b]: The second,\n    over two lines.\n';

  it('numbers footnotes by first reference and gathers them at the end', () => {
    const html = parseMarkdown(note);
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-');
    const refs = Array.from(html.matchAll(/data-footnote="(\d)"/g), (m) => m[1]);
    expect(refs).toEqual(['1', '2', '1']);
    expect(html).toMatch(/<section class="footnotes"><span class="footnotes-label u">Footnotes<\/span><ol class="footnotes-list">/);
    expect(html).toContain('data-footnote-id="a">');
    expect(html).toContain('The second,<br>over two lines.');
    // The definitions are not left where they were written.
    expect(html).not.toContain('[^a]:');
  });

  it('gives one back-link per reference', () => {
    const html = parseMarkdown(note);
    const backs = html.match(/class="footnote-back"/g) ?? [];
    expect(backs).toHaveLength(3);
    expect(html).toContain('aria-label="Back to reference 2 of footnote 1"');
  });

  it('leaves back-links off paper', () => {
    const html = parseMarkdown(note, undefined, { paper: true });
    expect(html).not.toContain('footnote-back');
    expect(html).toContain('class="footnotes"');
  });

  it('numbers inline notes in the same sequence', () => {
    const html = parseMarkdown('A^[an inline note] then B[^x].\n\n[^x]: named');
    expect(Array.from(html.matchAll(/data-footnote="(\d)"/g), (m) => m[1])).toEqual(['1', '2']);
    expect(html).toContain('data-footnote-inline=""><p>an inline note');
  });

  it('keeps an undefined reference and an unreferenced definition as text', () => {
    const html = parseMarkdown('Look[^nope].\n\n[^lonely]: nobody asked');
    expect(html).toContain('[^nope]');
    expect(html).not.toContain('footnote-ref');
    expect(html).toContain('[^lonely]: nobody asked');
    expect(html).not.toContain('class="footnotes"');
  });

  it('lets the first definition win and leaves the duplicate visible', () => {
    const html = parseMarkdown('A[^d].\n\n[^d]: first\n\n[^d]: second');
    expect(html).toContain('>first');
    expect(html).toContain('[^d]: second');
  });

  it('ignores footnote syntax inside code', () => {
    const html = parseMarkdown('`[^a]` and\n\n```\n[^a]: no\n```\n\n[^a]: yes');
    expect(html).not.toContain('footnote-ref');
    expect(html).toContain('[^a]: yes');
  });

  it('gives each render its own ids, so two notes on one page cannot collide', () => {
    const a = parseMarkdown('x[^1]\n\n[^1]: a');
    const b = parseMarkdown('x[^1]\n\n[^1]: b');
    const idOf = (html: string): string => /id="fn-([^"]+)"/.exec(html)?.[1] ?? '';
    expect(idOf(a)).not.toBe(idOf(b));
  });
});

describe('attachments', () => {
  it('frames a PDF alone on its line, with its name above', () => {
    const html = parseMarkdown('[report.pdf](note-asset://0123456789abcdef.pdf)');
    expect(html).toContain('<figure class="attachment-figure attachment-pdf"');
    expect(html).toContain('<iframe class="attachment-frame" src="note-asset://0123456789abcdef.pdf" title="report.pdf"></iframe>');
    expect(html).toContain('<span class="attachment-name">report.pdf</span>');
    expect(html).toContain('data-asset-size="0123456789abcdef.pdf"');
  });

  it('plays audio and video with controls and no preload', () => {
    expect(parseMarkdown('[a.mp3](note-asset://0123456789abcdef.mp3)')).toContain('<audio class="attachment-player" controls preload="none" src="note-asset://0123456789abcdef.mp3">');
    expect(parseMarkdown('[v.webm](note-asset://0123456789abcdef.webm)')).toContain('<video class="attachment-player" controls preload="none"');
  });

  it('makes any other file a chip that opens it', () => {
    const html = parseMarkdown('[budget.xlsx](note-asset://0123456789abcdef.xlsx)');
    expect(html).toContain('<a class="attachment attachment-chip" href="note-asset://0123456789abcdef.xlsx" data-asset="0123456789abcdef.xlsx">');
    expect(html).not.toContain('<iframe');
  });

  it('keeps a link inside a sentence a link, marked as an attachment', () => {
    const html = parseMarkdown('See [the brief](note-asset://0123456789abcdef.pdf) for more.');
    expect(html).toContain('<a class="attachment-link" href="note-asset://0123456789abcdef.pdf" data-asset="0123456789abcdef.pdf">the brief</a>');
    expect(html).not.toContain('<iframe');
    expect(parseMarkdown('[site](https://example.com "t")')).toContain('<a href="https://example.com" title="t">site</a>');
  });

  it('shows a name and no frame, player or link on paper', () => {
    const html = parseMarkdown('[report.pdf](note-asset://0123456789abcdef.pdf)\n\nSee [it](note-asset://0123456789abcdef.pdf).', undefined, { paper: true });
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('href="note-asset:');
    expect(html).toContain('<span class="attachment attachment-chip" data-asset="0123456789abcdef.pdf">');
    expect(html).toContain('<span class="attachment-link" data-asset="0123456789abcdef.pdf">it</span>');
  });

  it('draws an attached image as a picture, as before', () => {
    expect(parseMarkdown('![cat](note-asset://0123456789abcdef.png)')).toContain('<img src="note-asset://0123456789abcdef.png" alt="cat">');
  });
});
