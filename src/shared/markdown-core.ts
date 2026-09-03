import katex from 'katex';
import { marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { highlightCode } from '../renderer/highlight';
import { LINK_PATTERN } from '../renderer/notes';

/**
 * How markdown becomes HTML, in one place: the wikilink and math
 * extensions and the highlighted code renderer, on a marked instance of
 * this module's own so nothing else's `marked.use` can reach it. The
 * window sanitises the result with DOMPurify (renderer/markdown.ts); the
 * command line, writing an HTML export with the app closed, uses it as it
 * is (core/render.ts). Both read the same source, so the preview and the
 * export cannot disagree about what a note looks like.
 *
 * Math is KaTeX: `$x^2$` inline and `$$ … $$` on its own lines, rendered
 * to HTML with MathML beside it, as Notable and Obsidian do. A dollar
 * that is money ($5 and $6) is left alone: inline math may not open before
 * a space or close after one, and may not be followed by a digit.
 * Diagrams are ```mermaid fences; they come out as a `<pre class="mermaid">`
 * holding the source, and the window draws them afterwards (renderer/diagrams.ts).
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

// A link to another note, [[Like this]]. Written as a tokenizer rather than a
// pass over the source so that a wikilink inside a code block stays the
// characters that were typed, which is the whole point of a code block.
const WIKILINK = new RegExp(`^${LINK_PATTERN}`);

const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start: (src: string) => src.indexOf('[['),
  tokenizer(src: string) {
    const m = WIKILINK.exec(src);
    if (!m || !m[1].trim()) return undefined;
    return { type: 'wikilink', raw: m[0], text: m[1].trim() };
  },
  renderer(token) {
    const target = escapeHtml(token.text);
    return `<span class="inline-link" data-link="${target}">${target}</span>`;
  },
};

export function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
  } catch (err) {
    return `<span class="math-error" title="${escapeHtml(err instanceof Error ? err.message : String(err))}">${escapeHtml(tex)}</span>`;
  }
}

const blockMath: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  // Only a $$ that begins a line can start a block. Marked cuts the paragraph
  // it is reading at whatever this reports and joins the pieces back with a
  // newline — a line break, since breaks are on — so a $$ mid-line ("that
  // costs $$$") must not be reported at all.
  start: (src: string) => {
    const m = /\n\$\$/.exec(src);
    return m ? m.index + 1 : -1;
  },
  tokenizer(src: string) {
    const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (!m) return undefined;
    return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer(token) {
    return `<div class="math math-block">${renderMath(token.text, true)}</div>\n`;
  },
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start: (src: string) => {
    const i = src.search(/\$(?!\$)/);
    return i;
  },
  tokenizer(src: string) {
    // `$…$` on one line: not opening before a space, not closing after one,
    // not followed by a digit, and never `$$`.
    const m = /^\$(?!\$)(?![ \t])((?:\\\$|[^$\n])+?)(?<![ \t\\])\$(?!\d)/.exec(src);
    if (!m) return undefined;
    return { type: 'mathInline', raw: m[0], text: m[1] };
  },
  renderer(token) {
    return `<span class="math math-inline">${renderMath(token.text, false)}</span>`;
  },
};

/** The one marked instance, configured once. */
export const markdown = marked.setOptions({ gfm: true, breaks: true, async: false });

markdown.use({
  extensions: [wikilink, blockMath, inlineMath],
  renderer: {
    // Code is highlighted here, before sanitising, so the spans the
    // highlighter adds are checked like any other markup in the note. A
    // mermaid fence is handed on as its source for the window to draw.
    code({ text, lang }: Tokens.Code) {
      const name = (lang ?? '').trim().toLowerCase();
      if (name === 'mermaid') return `<pre class="mermaid" data-diagram>${escapeHtml(text)}</pre>\n`;
      const { html, language } = highlightCode(text, lang ?? '');
      const cls = language ? ` language-${language}` : '';
      return `<pre><code class="hljs${cls}">${html}</code></pre>\n`;
    },
  },
});

/** Markdown to HTML, unsanitised. */
export function parseMarkdown(source: string): string {
  return markdown.parse(source, { async: false }) as string;
}

/** Whether rendered HTML holds any KaTeX output, so a page only carries the math stylesheet when it needs it. */
export const hasMath = (html: string): boolean => html.includes('class="katex');

/** Whether rendered HTML still holds an undrawn diagram. */
export const hasDiagrams = (html: string): boolean => html.includes('data-diagram');
