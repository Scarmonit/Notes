import katex from 'katex';
import { marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { highlightCode } from '../renderer/highlight';
import { LINK_PATTERN, linkParts } from '../renderer/notes';

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
    if (!m) return undefined;
    const { target, alias } = linkParts(m[1]);
    if (!target) return undefined;
    return { type: 'wikilink', raw: m[0], text: target, alias };
  },
  renderer(token) {
    const target = escapeHtml(token.text);
    return `<span class="inline-link" data-link="${target}">${escapeHtml((token.alias as string | undefined) ?? token.text)}</span>`;
  },
};

/**
 * Where an embed's words come from. `![[Note]]` on a line of its own puts
 * that note's markdown in this one's place, and `![[Note#Heading]]` puts just
 * that section of it; what is drawn is what the source note says now, because
 * it is read at render time rather than copied.
 *
 * The window and the command line both have the notes to hand and both pass
 * one of these in; markdown-core itself knows nothing about a notebook.
 */
export type EmbedSource = (target: string, section: string | null) => { title: string; body: string } | null;

/** The source for the render in progress. Marked is synchronous, so one at a time is all there is. */
let embedSource: EmbedSource | null = null;
/** The embeds being drawn right now, so a note that embeds itself is refused rather than followed. */
const embedding: string[] = [];
/** How deep one note may reach through another. */
const EMBED_DEPTH = 4;

// `![[Note]]` or `![[Note#Heading]]` alone on a line.
const EMBED = /^!\[\[([^\[\]\n]+)\]\][ \t]*(?:\n+|$)/;

const embed: TokenizerAndRendererExtension = {
  name: 'embed',
  level: 'block',
  // As with block math: only a `![[` that begins a line can start one, or
  // marked would cut a paragraph at a mid-line match and rejoin it with a
  // line break.
  start: (src: string) => {
    if (src.startsWith('![[')) return 0;
    const m = /\n!\[\[/.exec(src);
    return m ? m.index + 1 : -1;
  },
  tokenizer(src: string) {
    const m = EMBED.exec(src);
    if (!m) return undefined;
    const hash = m[1].indexOf('#');
    const target = (hash < 0 ? m[1] : m[1].slice(0, hash)).trim();
    const section = hash < 0 ? null : m[1].slice(hash + 1).trim() || null;
    if (!target) return undefined;
    const found = embedSource?.(target, section) ?? null;
    const key = `${target.toLowerCase()}#${(section ?? '').toLowerCase()}`;
    if (!found || embedding.includes(key) || embedding.length >= EMBED_DEPTH) {
      const why = !found ? 'missing' : embedding.includes(key) ? 'circular' : 'deep';
      return { type: 'embed', raw: m[0], text: target, section, why, tokens: [] };
    }
    embedding.push(key);
    try {
      return { type: 'embed', raw: m[0], text: found.title, section, tokens: this.lexer.blockTokens(found.body) };
    } finally {
      embedding.pop();
    }
  },
  renderer(token) {
    const label = escapeHtml(token.text as string) + (token.section ? ` › ${escapeHtml(token.section as string)}` : '');
    const why = token.why as string | undefined;
    if (why) {
      const said =
        why === 'missing' ? 'No note called that' : why === 'circular' ? 'That note embeds this one' : 'Embedded too deeply to follow';
      return `<div class="embed embed-empty"><span class="embed-name">${label}</span><span class="embed-why">${said}</span></div>\n`;
    }
    return `<figure class="embed"><figcaption class="embed-name">${label}</figcaption>${this.parser.parse(token.tokens ?? [])}</figure>\n`;
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
  extensions: [embed, wikilink, blockMath, inlineMath],
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

/**
 * Markdown to HTML, unsanitised. With an `embeds` source, `![[Note]]` lines
 * are drawn as the note they name; without one they are drawn as an empty
 * embed, which is what an export made with no notebook to hand can honestly
 * say.
 */
export function parseMarkdown(source: string, embeds?: EmbedSource): string {
  embedSource = embeds ?? null;
  embedding.length = 0;
  try {
    return markdown.parse(source, { async: false }) as string;
  } finally {
    embedSource = null;
    embedding.length = 0;
  }
}

/** Whether rendered HTML holds any KaTeX output, so a page only carries the math stylesheet when it needs it. */
export const hasMath = (html: string): boolean => html.includes('class="katex');

/** Whether rendered HTML still holds an undrawn diagram. */
export const hasDiagrams = (html: string): boolean => html.includes('data-diagram');
