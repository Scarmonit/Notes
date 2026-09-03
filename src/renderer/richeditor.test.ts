import { beforeEach, describe, expect, it } from 'vitest';
import { renderEditor, serializeEditor } from './richeditor';

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
