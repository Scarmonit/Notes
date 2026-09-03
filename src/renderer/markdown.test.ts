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

  it('treats single newlines as line breaks', () => {
    expect(renderMarkdown('line one\nline two')).toContain('<br>');
  });

  it('strips scripts and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[x](javascript:alert(1))');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('sends links to a new window so the main process can open them externally', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
