import { describe, expect, it } from 'vitest';
import { CHIP_PLACEHOLDER, decorateLine, decorateLines, inlineHtml, isDecorated } from './inline';

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
