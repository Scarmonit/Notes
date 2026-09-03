import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, emphasis, lists and code', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** text\n\n- one\n- two\n\n`code`');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(html).toContain('<code>code</code>');
  });

  it('renders GFM task lists and tables', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table>');
  });

  it('keeps a task list checkbox tickable: the box, and which ones are ticked', () => {
    // The preview turns these into live checkboxes, so sanitizing must not drop
    // the input or lose which of them are already done.
    const boxes = renderMarkdown('- [x] done\n- [ ] todo').match(/<input[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('checked');
    expect(boxes[1]).not.toContain('checked');
  });

  it('treats single newlines as line breaks', () => {
    expect(renderMarkdown('line one\nline two')).toContain('<br>');
  });

  it('strips scripts and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[x](javascript:alert(1))');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('keeps attached images but still drops other odd schemes', () => {
    const html = renderMarkdown('![cat](note-asset://deadbeef.png)\n\n![x](file:///C:/secret.png)\n\n<img src="javascript:alert(1)">');
    expect(html).toContain('src="note-asset://deadbeef.png"');
    expect(html).not.toContain('file:///');
    expect(html).not.toContain('javascript:');
  });

  it('sends links to a new window so the main process can open them externally', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('sized attachments', () => {
  it('keeps the width on an attached <img> tag', () => {
    const html = renderMarkdown('<img src="note-asset://deadbeef.png" alt="garden" width="320">');
    expect(html).toContain('src="note-asset://deadbeef.png"');
    expect(html).toContain('width="320"');
  });
});

describe('code blocks', () => {
  it('highlights a fence that names a language', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('class="hljs language-javascript"');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it('leaves a fence with no language as plain, escaped code', () => {
    const html = renderMarkdown('```\n.npc add 36597 <one>\n```');
    expect(html).toBe('<pre><code class="hljs">.npc add 36597 &lt;one&gt;</code></pre>\n');
  });

  it('does not colour a language it does not know', () => {
    expect(renderMarkdown('```klingon\nHIja\n```')).not.toContain('language-');
  });
});

describe('note links', () => {
  it('renders [[a link]] as a chip carrying its target', () => {
    expect(renderMarkdown('see [[Other note]]')).toContain('<span class="inline-link" data-link="Other note">Other note</span>');
  });

  it('leaves a link inside code as the characters that were typed', () => {
    expect(renderMarkdown('`[[not a link]]`')).toContain('<code>[[not a link]]</code>');
    expect(renderMarkdown('```\n[[not a link]]\n```')).toContain('[[not a link]]');
  });

  it('makes no element out of a target that looks like markup', () => {
    const holder = document.createElement('div');
    holder.innerHTML = renderMarkdown('[[<img src=x onerror=alert(1)>]]');
    expect(holder.querySelector('img')).toBe(null);
    expect(holder.querySelector('.inline-link')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
