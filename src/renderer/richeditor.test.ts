import { beforeEach, describe, expect, it } from 'vitest';
import {
  MIN_IMAGE_WIDTH,
  chipWidth,
  lineIndexAt,
  lineSpans,
  moveImageBy,
  moveImageToLine,
  renderEditor,
  serializeEditor,
  setChipWidth,
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
    expect(lineIndexAt(div, { node: div, offset: Array.from(div.childNodes).indexOf(img) })).toBe(1);
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
