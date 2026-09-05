import { describe, expect, it } from 'vitest';
import { CHIP_PLACEHOLDER, calloutParts, decorateLine, decorateLines, inlineHtml, isDecorated } from './inline';

/** The text a browser would show for the HTML: what the serializer reads back. */
function textOf(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html.replaceAll(CHIP_PLACEHOLDER, '');
  return t.content.textContent ?? '';
}

const classesOf = (html: string): string[] => Array.from(html.matchAll(/class="([^"]+)"/g), (m) => m[1]);

describe('the text is never changed', () => {
  const lines = [
    '# A heading with **bold** and `code`',
    '## Two ##',
    '> a quote with *emphasis*',
    '- a list item',
    '1. numbered with ~~struck~~ words',
    '- [ ] to do',
    '- [x] done **already**',
    'plain with a [link](https://example.com/a?b=c&d) and #tag/part',
    'ampersands & angles <b> stay text',
    'snake_case_word is not emphasis, nor 2*3*4',
    '```js',
    'inside a fence **not bold**',
    '```',
    '',
    '   ',
  ];
  it.each(lines)('round-trips %j', (line) => {
    expect(textOf(decorateLine(line, false))).toBe(line);
  });
});

describe('decorateLine', () => {
  it('wraps a heading with its marker apart', () => {
    const html = decorateLine('## Title', false);
    expect(classesOf(html)).toEqual(['md-h md-h2', 'md-mark']);
    expect(html).toContain('<span class="md-mark">## </span>Title');
  });

  it('formats emphasis, code, strike, links and tags inline', () => {
    const html = inlineHtml('**b** *i* `c` ~~s~~ [t](u) #tag');
    expect(classesOf(html)).toEqual(
      expect.arrayContaining(['md-strong', 'md-em', 'md-code', 'md-strike', 'md-link', 'md-tag']),
    );
  });

  it('does not read underscores inside words or stars in arithmetic as emphasis', () => {
    expect(isDecorated(inlineHtml('snake_case_word'))).toBe(false);
    expect(isDecorated(inlineHtml('2*3*4'))).toBe(false);
    expect(isDecorated(inlineHtml('a * b * c'))).toBe(false);
  });

  it('leaves the inside of a code span alone', () => {
    const html = inlineHtml('`**not bold**`');
    expect(html).not.toContain('md-strong');
  });

  it('nests emphasis inside bold but not without limit', () => {
    expect(inlineHtml('**bold *and italic* here**')).toContain('md-em');
    expect(inlineHtml('**a *b **c** d* e**').match(/md-strong/g)).toHaveLength(1);
  });

  it('strikes through a done task and not an open one', () => {
    expect(decorateLine('- [x] done', false)).toContain('md-done');
    expect(decorateLine('- [ ] open', false)).not.toContain('md-done');
    expect(decorateLine('- [ ] open', false)).toContain('md-bullet');
  });

  it('draws fence lines and the lines inside them as code', () => {
    const html = decorateLines(['before', '```', '# not a heading', '```', '# heading']);
    expect(html[1]).toContain('md-fence');
    expect(html[2]).toContain('md-codeline');
    expect(html[2]).not.toContain('md-h');
    expect(html[4]).toContain('md-h1');
  });

  it('keeps chips as placeholders and formats around them', () => {
    const line = 'see [[Other]] and **this**';
    const chip = { start: 4, end: 13 };
    const html = decorateLine(line, false, [chip]);
    expect(html).toBe(`see ${CHIP_PLACEHOLDER} and <span class="md-strong"><span class="md-mark">**</span>this<span class="md-mark">**</span></span>`);
    expect(decorateLine('---', false, [{ start: 0, end: 3 }])).toBe(CHIP_PLACEHOLDER);
  });

  it('is empty for an empty line and plain for a plain one', () => {
    expect(decorateLine('', false)).toBe('');
    expect(decorateLine('just words', false)).toBe('just words');
    expect(isDecorated('just words')).toBe(false);
  });
});

describe('callouts in the editor', () => {
  it('marks the head and body lines of a callout, and types the head', () => {
    const html = decorateLines(['> [!info]- A title', '> body words', '', '> plain quote']);
    expect(classesOf(html[0])).toEqual(['md-quote md-callout md-callout-head', 'md-mark', 'md-callout-type']);
    expect(html[0]).toContain('<span class="md-callout-type">[!info]-</span> A title');
    expect(classesOf(html[1])).toEqual(['md-quote md-callout md-callout-body', 'md-mark']);
    expect(classesOf(html[3])).toEqual(['md-quote', 'md-mark']);
  });

  it('keeps the text of every line unchanged', () => {
    for (const line of ['> [!tip]+ **bold** title', '> [!foo]', '> > [!warning] nested']) {
      expect(textOf(decorateLines([line])[0])).toBe(line);
    }
  });

  it('follows a nested callout and ends at the first unquoted line or a fence', () => {
    const parts = calloutParts(['> [!note]', '> > [!tip] in', '> > more', '> back', 'out', '```', '> [!info] fenced', '```']);
    expect(parts).toEqual(['head', 'head', 'body', 'body', null, null, null, null]);
  });
});

describe('footnotes in the editor', () => {
  it('shapes a reference, an inline note and a definition, text unchanged', () => {
    const ref = decorateLine('words[^a] here', false);
    expect(ref).toContain('<span class="md-fnref"><span class="md-mark">[^</span><span class="md-fnid">a</span><span class="md-mark">]</span></span>');
    expect(textOf(ref)).toBe('words[^a] here');
    const inline = decorateLine('see ^[an aside with [[Plan]]] now', false);
    expect(inline).toContain('<span class="md-fninline"><span class="md-mark">^[</span>');
    expect(textOf(inline)).toBe('see ^[an aside with [[Plan]]] now');
    const def = decorateLine('[^a]: The **note**', false);
    expect(def).toContain('<span class="md-fndef"><span class="md-fnlabel">[^a]: </span>');
    expect(def).toContain('<span class="md-strong">');
    expect(textOf(def)).toBe('[^a]: The **note**');
  });

  it('does not take a link, an escaped bracket or a definition label for a reference', () => {
    expect(decorateLine('[^a](https://x)', false)).toContain('md-link');
    expect(decorateLine('\\[^a] and \\^[no]', false)).not.toContain('md-fn');
    expect(decorateLine('[^a]: def', false)).not.toContain('md-fnref');
  });
});

describe('fold hints', () => {
  it('marks a heading or a list bullet that can fold, says whether it is folded, and keeps the text', () => {
    const open = decorateLines(['## Head', '- item', '  - child'], [], ['foldable', 'foldable', null]);
    expect(open[0]).toContain('<span class="md-h md-h2 md-foldable" data-fold="open">');
    expect(open[1]).toContain('<span class="md-bullet md-foldable" data-fold="open">- </span>item');
    expect(open[2]).toContain('<span class="md-bullet">  - </span>child');
    const closed = decorateLines(['## Head', 'words'], [], ['folded']);
    expect(closed[0]).toContain('<span class="md-h md-h2 md-foldable md-folded" data-fold="closed">');
    for (const html of [...open, ...closed]) {
      // Well-formed attributes: what the browser reads back is exactly the line.
      const t = document.createElement('template');
      t.innerHTML = html;
      expect(t.content.querySelectorAll('[data-fold]').length).toBeLessThanOrEqual(1);
    }
    expect(textOf(open[1])).toBe('- item');
    expect(textOf(closed[0])).toBe('## Head');
  });
});
