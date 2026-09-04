import { beforeEach, describe, expect, it } from 'vitest';
import {
  MIN_IMAGE_WIDTH,
  bodyTokens,
  imageMarkdown,
  chipWidth,
  imageTokens,
  paragraphBounds,
  isLink,
  isRule,
  lineIndexAt,
  lineSpans,
  moveImageBy,
  moveImageToLine,
  renderEditor,
  serializeEditor,
  setChipWidth,
  textBefore,
  docOf,
  offsetOf,
  posAt,
  rangeBetween,
  readEditor,
} from './richeditor';

const NAME = 'deadbeef12ab34cd.png';

function editor(): HTMLElement {
  const div = document.createElement('div');
  document.body.append(div);
  return div;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('render then serialize round-trip', () => {
  const cases = [
    'plain text',
    'line one\nline two',
    'a blank line\n\nfollows here',
    `text before\n![garden](note-asset://${NAME})\ntext after`,
    `![only an image](note-asset://${NAME})`,
    `two\n![a](note-asset://${NAME})\n![b](note-asset://deadbeef99887766.jpg)\nlines`,
    '# Heading stays literal\n\n- a list\n- of items',
    '',
  ];
  it.each(cases)('round-trips %j', (body) => {
    const div = editor();
    renderEditor(div, body);
    expect(serializeEditor(div)).toBe(body);
  });
});

describe('renderEditor', () => {
  it('turns an attachment into a picture chip carrying its name and alt', () => {
    const div = editor();
    renderEditor(div, `![garden photo](note-asset://${NAME})`);
    const img = div.querySelector('img.inline-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`note-asset://${NAME}`);
    expect(img.dataset.asset).toBe(NAME);
    expect(img.dataset.alt).toBe('garden photo');
    expect(img.contentEditable).toBe('false');
  });

  it('leaves web images and other markdown as plain text', () => {
    const div = editor();
    renderEditor(div, '![web](https://example.com/x.png) and **bold**');
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toBe('![web](https://example.com/x.png) and **bold**');
  });

  it('flags an empty body so the placeholder can show', () => {
    const div = editor();
    renderEditor(div, '');
    expect(div.classList.contains('is-empty')).toBe(true);
    renderEditor(div, 'x');
    expect(div.classList.contains('is-empty')).toBe(false);
  });
});

describe('serializeEditor tolerates browser editing structures', () => {
  it('reads <br> and <div> lines the way a browser builds them', () => {
    const div = editor();
    div.innerHTML = 'first<div>second</div><div><br></div><div>fourth</div>';
    expect(serializeEditor(div)).toBe('first\nsecond\n\nfourth');
  });

  it('reconstructs an image even if the chip lost its data attributes', () => {
    const div = editor();
    div.innerHTML = `before<img class="inline-img" src="note-asset://${NAME}">after`;
    expect(serializeEditor(div)).toBe(`before![image](note-asset://${NAME})after`);
  });

  it('drops a single trailing line-break the browser keeps for the caret', () => {
    const div = editor();
    div.innerHTML = 'done<br>';
    expect(serializeEditor(div)).toBe('done');
  });
});

describe('sized images', () => {
  const sized = `<img src="note-asset://${NAME}" alt="garden" width="320">`;

  it.each([
    `above\n${sized}\nbelow`,
    `<img src="note-asset://${NAME}" alt="a &quot;quoted&quot; &lt;alt&gt;" width="200">`,
    `![natural](note-asset://${NAME})\n${sized}`,
  ])('round-trips %j', (body) => {
    const div = editor();
    renderEditor(div, body);
    expect(serializeEditor(div)).toBe(body);
  });

  it('renders the width onto the chip and reads it back', () => {
    const div = editor();
    renderEditor(div, sized);
    const img = div.querySelector('img.inline-img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('320');
    expect(img.style.width).toBe('320px');
    expect(chipWidth(img)).toBe(320);
  });

  it('switches between the markdown and tag forms as the width changes', () => {
    const div = editor();
    renderEditor(div, `![garden](note-asset://${NAME})`);
    const img = div.querySelector('img.inline-img') as HTMLImageElement;
    setChipWidth(img, 240.4);
    expect(serializeEditor(div)).toBe(`<img src="note-asset://${NAME}" alt="garden" width="240">`);
    setChipWidth(img, null);
    expect(serializeEditor(div)).toBe(`![garden](note-asset://${NAME})`);
  });

  it('clamps a width below the minimum', () => {
    const div = editor();
    renderEditor(div, sized);
    const img = div.querySelector('img.inline-img') as HTMLImageElement;
    setChipWidth(img, 5);
    expect(chipWidth(img)).toBe(MIN_IMAGE_WIDTH);
  });

  it('leaves img tags that are not our attachments as text', () => {
    const div = editor();
    const body = '<img src="https://example.com/x.png" width="20"> and <img src="note-asset://../etc/passwd">';
    renderEditor(div, body);
    expect(div.querySelector('img')).toBeNull();
    expect(serializeEditor(div)).toBe(body);
  });

  it('accepts a tag with attributes in any order or quoting', () => {
    const div = editor();
    renderEditor(div, `<img width=150 alt='pic' src="note-asset://${NAME}">`);
    const img = div.querySelector('img.inline-img') as HTMLImageElement;
    expect(img.dataset.alt).toBe('pic');
    expect(chipWidth(img)).toBe(150);
    expect(serializeEditor(div)).toBe(`<img src="note-asset://${NAME}" alt="pic" width="150">`);
  });
});

describe('lines', () => {
  it('maps DOM positions to markdown lines across text, <br> and <div> breaks', () => {
    const div = editor();
    div.innerHTML = 'one<br>two<div>three</div><div>four\nfive<br></div>';
    expect(serializeEditor(div)).toBe('one\ntwo\nthree\nfour\nfive');
    const spans = lineSpans(div);
    expect(spans).toHaveLength(5);
    const t = (s: string): Text => {
      const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) if ((n.textContent ?? '').includes(s)) return n as Text;
      throw new Error(s);
    };
    expect(lineIndexAt(div, { node: t('one'), offset: 1 })).toBe(0);
    expect(lineIndexAt(div, { node: t('two'), offset: 0 })).toBe(1);
    expect(lineIndexAt(div, { node: t('three'), offset: 2 })).toBe(2);
    expect(lineIndexAt(div, { node: t('four'), offset: 2 })).toBe(3);
    expect(lineIndexAt(div, { node: t('four'), offset: 6 })).toBe(4);
  });

  it('puts an image chip on the line it sits on', () => {
    const div = editor();
    renderEditor(div, `a\n![x](note-asset://${NAME})\nb`);
    const img = div.querySelector('img') as HTMLImageElement;
    const doc = docOf(div);
    expect(lineIndexAt(div, { node: doc, offset: Array.from(doc.childNodes).indexOf(img) })).toBe(1);
  });
});

describe('moveImageToLine', () => {
  const A = `![a](note-asset://${NAME})`;
  const B = `<img src="note-asset://deadbeef99887766.jpg" alt="b" width="100">`;

  it('moves a lone image line up and down without leaving blanks', () => {
    const body = `one\n${A}\ntwo\nthree`;
    expect(moveImageToLine(body, 0, 0)).toEqual({ body: `${A}\none\ntwo\nthree`, index: 0 });
    expect(moveImageToLine(body, 0, 3)).toEqual({ body: `one\ntwo\n${A}\nthree`, index: 0 });
    expect(moveImageToLine(body, 0, 4)).toEqual({ body: `one\ntwo\nthree\n${A}`, index: 0 });
  });

  it('is a no-op when dropped where it already is', () => {
    const body = `one\n${A}\ntwo`;
    expect(moveImageToLine(body, 0, 1).body).toBe(body);
    expect(moveImageToLine(body, 0, 2).body).toBe(body);
  });

  it('lifts an image out of a text line onto its own line', () => {
    expect(moveImageToLine(`before ${A} after\nnext`, 0, 2).body).toBe(`before  after\nnext\n${A}`);
    expect(moveImageToLine(`before ${A} after\nnext`, 0, 0).body).toBe(`${A}\nbefore  after\nnext`);
  });

  it('tracks the moved image index among several', () => {
    const body = `${A}\nx\n${B}\ny`;
    const moved = moveImageToLine(body, 0, 4);
    expect(moved.body).toBe(`x\n${B}\ny\n${A}`);
    expect(moved.index).toBe(1);
    const back = moveImageToLine(moved.body, 1, 0);
    expect(back).toEqual({ body, index: 0 });
  });

  it('clamps out-of-range targets and ignores a missing image', () => {
    expect(moveImageToLine(`x\n${A}`, 0, 99).body).toBe(`x\n${A}`);
    expect(moveImageToLine(`x\n${A}`, 0, -5).body).toBe(`${A}\nx`);
    expect(moveImageToLine('plain', 3, 0)).toEqual({ body: 'plain', index: 3 });
  });
});

describe('moveImageBy', () => {
  const A = `![a](note-asset://${NAME})`;

  it('swaps a lone image with its neighbouring line', () => {
    expect(moveImageBy(`one\n${A}\ntwo`, 0, -1).body).toBe(`${A}\none\ntwo`);
    expect(moveImageBy(`one\n${A}\ntwo`, 0, 1).body).toBe(`one\ntwo\n${A}`);
  });

  it('steps an inline image onto its own line', () => {
    expect(moveImageBy(`one ${A}\ntwo`, 0, -1).body).toBe(`${A}\none \ntwo`);
    expect(moveImageBy(`one ${A}\ntwo`, 0, 1).body).toBe(`one \n${A}\ntwo`);
  });

  it('stops at the edges', () => {
    expect(moveImageBy(`${A}\ntwo`, 0, -1).body).toBe(`${A}\ntwo`);
    expect(moveImageBy(`one\n${A}`, 0, 1).body).toBe(`one\n${A}`);
  });
});

describe('section rules', () => {
  it.each(['a\n\n---\nb', '---', 'x\n---', 'one\n\n---\n\n---\n\ntwo'])('round-trips %j', (body) => {
    const div = editor();
    renderEditor(div, body);
    expect(serializeEditor(div)).toBe(body);
  });

  it('renders a rule line as a non-editable hr', () => {
    const div = editor();
    renderEditor(div, 'a\n\n---\nb');
    const hr = div.querySelector('hr.inline-rule') as HTMLHRElement;
    expect(hr).toBeTruthy();
    expect(hr.contentEditable).toBe('false');
    expect(isRule(hr)).toBe(true);
  });

  it('leaves dashes that are not alone on a line as text', () => {
    const div = editor();
    for (const body of ['a --- b', '--', '- - -', '----x']) {
      renderEditor(div, body);
      expect(div.querySelector('hr')).toBeNull();
      expect(serializeEditor(div)).toBe(body);
    }
  });

  it('writes a rule back with the marker it was written with: under a paragraph, --- would make a heading', () => {
    const div = editor();
    renderEditor(div, 'a\n*****\nb');
    expect(div.querySelector('hr.inline-rule')).toBeTruthy();
    expect(serializeEditor(div)).toBe('a\n*****\nb');
    renderEditor(div, 'a\n\n-----\n\n___\nb');
    expect(div.querySelectorAll('hr.inline-rule')).toHaveLength(2);
    expect(serializeEditor(div)).toBe('a\n\n-----\n\n___\nb');
  });

  it('leaves --- under a line of text as the setext underline it is, but keeps it a rule after a heading, a list or a fence', () => {
    const div = editor();
    renderEditor(div, 'Intro\n---\nMore');
    expect(div.querySelector('hr')).toBeNull();
    expect(serializeEditor(div)).toBe('Intro\n---\nMore');
    for (const body of ['# H\n---', '- item\n---', '> q\n---', '```\nx\n```\n---', '---\n---']) {
      renderEditor(div, body);
      expect(div.querySelectorAll('hr.inline-rule').length, body).toBeGreaterThan(0);
      expect(serializeEditor(div)).toBe(body);
    }
  });

  it('falls back to the img form for an alt the markdown form could not read back', () => {
    const md = imageMarkdown({ name: 'abcdef12.png', alt: 'x]y', width: null });
    expect(md).toBe('<img src="note-asset://abcdef12.png" alt="x]y">');
    expect(imageTokens(md)).toMatchObject([{ name: 'abcdef12.png', alt: 'x]y', width: null }]);
    expect(imageMarkdown({ name: 'abcdef12.png', alt: 'plain', width: null })).toBe('![plain](note-asset://abcdef12.png)');
  });

  it('keeps image indices stable with rules in between', () => {
    const body = `![a](note-asset://${NAME})\n---\n![b](note-asset://deadbeef99887766.jpg)`;
    expect(moveImageToLine(body, 1, 0).body).toBe(`![b](note-asset://deadbeef99887766.jpg)\n![a](note-asset://${NAME})\n---`);
  });
});

describe('textBefore', () => {
  it('keeps trailing newlines so the caret line can be judged', () => {
    const div = editor();
    renderEditor(div, 'one\ntwo\n');
    const text = docOf(div).firstChild as Text;
    expect(textBefore(div, { node: text, offset: 8 })).toBe('one\ntwo\n');
    expect(textBefore(div, { node: text, offset: 5 })).toBe('one\nt');
    expect(textBefore(div, { node: div, offset: 0 })).toBe('');
  });
});

describe('paragraphBounds', () => {
  const lines = ['one', 'two', '', 'three', 'four', 'five'];

  it('reaches to the blank lines on either side', () => {
    expect(paragraphBounds(lines, 4)).toEqual({ first: 3, last: 5 });
    expect(paragraphBounds(lines, 0)).toEqual({ first: 0, last: 1 });
  });

  it('gives a blank line to itself, so the dimming holds still between blocks', () => {
    expect(paragraphBounds(lines, 2)).toEqual({ first: 2, last: 2 });
  });

  it('treats a whitespace-only line as blank', () => {
    expect(paragraphBounds(['a', '   ', 'b'], 0)).toEqual({ first: 0, last: 0 });
  });

  it('holds a line index that is off the end', () => {
    expect(paragraphBounds(lines, 99)).toEqual({ first: 3, last: 5 });
    expect(paragraphBounds([], 0)).toEqual({ first: 0, last: 0 });
  });
});

describe('note links', () => {
  it('renders a link as a chip and writes it back unchanged', () => {
    const root = editor();
    renderEditor(root, 'see [[Other note]] here');
    const chip = root.querySelector('.inline-link');
    expect(chip?.textContent).toBe('Other note');
    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(isLink(chip)).toBe(true);
    expect(serializeEditor(root)).toBe('see [[Other note]] here');
  });

  it('writes back the target, not whatever the chip is showing', () => {
    const root = editor();
    renderEditor(root, '[[Other note]]');
    const chip = root.querySelector('.inline-link') as HTMLElement;
    chip.textContent = 'something else';
    expect(serializeEditor(root)).toBe('[[Other note]]');
  });

  it('shows an aliased link by its alias and writes both back', () => {
    const root = editor();
    renderEditor(root, 'see [[Other note|that one]]');
    const chip = root.querySelector('.inline-link') as HTMLElement;
    expect(chip.textContent).toBe('that one');
    expect(chip.dataset.link).toBe('Other note');
    expect(serializeEditor(root)).toBe('see [[Other note|that one]]');
  });

  it('leaves the index of an image alone', () => {
    const body = `[[a link]] ![one](note-asset://${NAME}) [[another]] ![two](note-asset://${NAME})`;
    expect(bodyTokens(body).map((t) => t.kind)).toEqual(['link', 'image', 'link', 'image']);
    expect(imageTokens(body).map((t) => t.alt)).toEqual(['one', 'two']);
  });

  it('keeps an empty or broken link as plain text', () => {
    const root = editor();
    renderEditor(root, '[[ ]] and [[open');
    expect(root.querySelector('.inline-link')).toBe(null);
    expect(serializeEditor(root)).toBe('[[ ]] and [[open');
  });
});

describe('segments and posAt', () => {
  it('maps every offset of a plain text to the text node', () => {
    const div = editor();
    renderEditor(div, 'ab\ncd');
    const { text, segments } = readEditor(div);
    expect(text).toBe('ab\ncd');
    expect(segments).toHaveLength(1);
    const p = posAt(segments, 4);
    expect(p).toEqual({ node: docOf(div).firstChild, offset: 4 });
  });

  it('maps offsets around chips to positions beside them, and inside text before beside a block', () => {
    const div = editor();
    renderEditor(div, `a\n![x](note-asset://${NAME})\nb`);
    const { segments, text } = readEditor(div);
    const img = div.querySelector('img') as HTMLImageElement;
    const doc = docOf(div);
    const imgAt = text.indexOf('![');
    // Before the picture: the end of the text node before it, not "beside the img".
    expect(posAt(segments, imgAt)).toEqual({ node: doc.firstChild, offset: 2 });
    // Inside its markdown: after the picture.
    expect(posAt(segments, imgAt + 3)).toEqual({ node: doc, offset: Array.from(doc.childNodes).indexOf(img) + 1 });
    expect(rangeBetween(div, segments, 0, 1)?.toString()).toBe('a');
  });

  it('prefers plain text over a formatting wrapper on a boundary', () => {
    const div = editor();
    div.innerHTML = 'a <span class="md-strong"><span class="md-mark">**</span>b<span class="md-mark">**</span></span> c';
    const { text, segments } = readEditor(div);
    expect(text).toBe('a **b** c');
    const after = posAt(segments, 7) as { node: Node; offset: number };
    expect(after.node).toBe(div.lastChild);
    expect(after.offset).toBe(0);
    const before = posAt(segments, 2) as { node: Node; offset: number };
    expect(before.node).toBe(div.firstChild);
    expect(before.offset).toBe(2);
    expect(offsetOf(div, { node: div.lastChild as Node, offset: 1 })).toBe(8);
  });

  it('reads back the markdown through formatting wrappers unchanged', () => {
    const div = editor();
    div.innerHTML = '<span class="md-h md-h2"><span class="md-mark"># </span>Title</span><br>plain <span class="md-em"><span class="md-mark">*</span>i<span class="md-mark">*</span></span>';
    expect(serializeEditor(div)).toBe('# Title\nplain *i*');
    expect(lineSpans(div)).toHaveLength(2);
  });
});

describe('code fences in the editor', () => {
  it('makes no chip of a rule or a link inside a fence: there they are the characters typed', () => {
    const body = '```\n---\n[[x]]\n```\n---\n[[y]]';
    expect(bodyTokens(body).map((t) => [t.kind, body.slice(t.start, t.end)])).toEqual([
      ['rule', '---'],
      ['link', '[[y]]'],
    ]);
    expect(bodyTokens('~~~\n---\n[[x]]')).toEqual([]);
    const div = editor();
    renderEditor(div, body);
    expect(div.querySelectorAll('hr.inline-rule')).toHaveLength(1);
    expect(serializeEditor(div)).toBe(body);
  });
});

describe('embeds in the editor', () => {
  it('reads `![[Note]]` as an embed, not as a link with a bang in front', () => {
    expect(bodyTokens('![[Plans]]')).toEqual([{ kind: 'embed', target: 'Plans', start: 0, end: 10 }]);
  });

  it('keeps the section an embed names', () => {
    expect(bodyTokens('![[Plans#Order]]')).toEqual([{ kind: 'embed', target: 'Plans#Order', start: 0, end: 16 }]);
  });

  it('still reads a link with no bang as a link', () => {
    expect(bodyTokens('[[Plans]]')).toEqual([{ kind: 'link', target: 'Plans', start: 0, end: 9 }]);
  });

  it('leaves the index of an image where it was: an embed is a later kind', () => {
    const body = `![a](note-asset://${NAME}) then ![[Plans]]`;
    expect(imageTokens(body)).toHaveLength(1);
    expect(imageTokens(body)[0].start).toBe(0);
  });

  it('draws an embed as its own chip and writes it back as it was', () => {
    const div = editor();
    renderEditor(div, 'before\n![[Plans#Order]]\nafter');
    const chip = div.querySelector('.inline-embed');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-link')).toBe('Plans#Order');
    expect(serializeEditor(div)).toBe('before\n![[Plans#Order]]\nafter');
  });

  it('leaves an embed inside a code fence as the characters typed', () => {
    expect(bodyTokens('```\n![[Plans]]\n```')).toEqual([]);
  });
});
