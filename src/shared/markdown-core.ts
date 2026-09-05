import katex from 'katex';
import { marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { highlightCode } from '../renderer/highlight';
import { withoutMarkers } from '../core/blocks';
import { LINK_PATTERN, formatLinkAddress, linkLabel, parseLinkAddress } from '../renderer/notes';
import { assetKind, assetNameFromUrl, assetUrl } from './assets';
import { calloutHead, QUOTE_PREFIX } from './callouts';
import { scanFootnotes, type FootnoteScan } from './footnotes';

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
    const parsed = parseLinkAddress(m[1]);
    if (!parsed.target && !parsed.block && !parsed.heading) return undefined;
    const target = formatLinkAddress({ ...parsed, alias: undefined });
    return { type: 'wikilink', raw: m[0], text: target, alias: parsed.alias };
  },
  renderer(token) {
    const target = escapeHtml(token.text);
    return `<span class="inline-link" data-link="${target}">${escapeHtml((token.alias as string | undefined) ?? linkLabel(token.text))}</span>`;
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
    const parsed = parseLinkAddress(m[1]);
    const target = parsed.target;
    // A block is addressed as `#^id` and a heading by its words; the source
    // is asked for whichever the link named.
    const section = parsed.block ? `^${parsed.block}` : (parsed.heading ?? null);
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
    // A block address is set apart with a dot and a heading with a chevron,
    // the same way a link chip in the editor tells the two apart.
    const section = token.section as string | undefined;
    const label = escapeHtml(token.text as string) + (section ? `${section.startsWith('^') ? ' · ' : ' › '}${escapeHtml(section)}` : '');
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

/**
 * How a render should differ from the preview. `paper` is the PDF, the PNG
 * and print: nothing there can be clicked or played, so a foldable callout is
 * shown open, a footnote's back-links are left off, and an attachment is a
 * name rather than a frame.
 */
export interface RenderOptions {
  paper?: boolean;
}

/** The options for the render in progress. */
let renderOptions: RenderOptions = {};

// --- callouts ---------------------------------------------------------------

// The first line of a callout: a quote marker and `[!type]`.
const CALLOUT_START = /^ {0,3}>[ ]?\[!/;

/** Whether a line goes on with the quote that is being read. */
const quoted = (line: string): boolean => /^ {0,3}>/.test(line);

const callout: TokenizerAndRendererExtension = {
  name: 'callout',
  level: 'block',
  // As with block math: only a `> [!` that begins a line can start one. Marked
  // asks this of the source one character in, so answering 0 here would cut a
  // paragraph one character after it began; a block start is always after a
  // newline, and at the very start of the source the tokenizer is tried anyway.
  start: (src: string) => {
    const m = /\n {0,3}>[ ]?\[!/.exec(src);
    return m ? m.index + 1 : -1;
  },
  tokenizer(src: string) {
    if (!CALLOUT_START.test(src)) return undefined;
    const lines = src.split('\n');
    const head = calloutHead(lines[0].replace(QUOTE_PREFIX, ''));
    if (!head) return undefined;
    let n = 1;
    while (n < lines.length && quoted(lines[n])) n++;
    const raw = lines.slice(0, n).join('\n') + (n < lines.length ? '\n' : '');
    const inner = lines
      .slice(1, n)
      .map((l) => l.replace(QUOTE_PREFIX, ''))
      .join('\n');
    return {
      type: 'callout',
      raw,
      kind: head.kind,
      label: head.label,
      fold: head.fold,
      titleTokens: head.title ? this.lexer.inlineTokens(head.title) : [],
      tokens: inner.trim() ? this.lexer.blockTokens(inner) : [],
    };
  },
  renderer(token) {
    const kind = escapeHtml(token.kind as string);
    const fold = token.fold as '-' | '+' | null;
    const title = (token.titleTokens as Tokens.Generic[]).length > 0 ? `<span class="callout-title">${this.parser.parseInline(token.titleTokens as Tokens.Generic[])}</span>` : '';
    const label = `<span class="callout-label u">${escapeHtml(token.label as string)}</span>${title}`;
    const body = this.parser.parse(token.tokens ?? []);
    if (fold && !renderOptions.paper) {
      return `<details class="callout" data-callout="${kind}"${fold === '+' ? ' open' : ''}><summary class="callout-head">${label}</summary><div class="callout-body">${body}</div></details>\n`;
    }
    return `<div class="callout" data-callout="${kind}"><div class="callout-head">${label}</div><div class="callout-body">${body}</div></div>\n`;
  },
};

// --- footnotes --------------------------------------------------------------

/** The footnotes of the note being rendered, or null when it has none. */
let footnotes: FootnoteScan | null = null;
/** How many times each numbered footnote has been referred to so far in this render. */
let refCounts = new Map<number, number>();
/** Which inline notes have been drawn, so each is numbered once. */
let inlinesDrawn = 0;
/** A short name for this render, so two renders on one page cannot share an id. */
let renderTag = '';
let renders = 0;

const FOOTNOTE_REF = /^\[\^([^\s[\]]+)\](?!:)/;

function refHtml(number: number): string {
  const k = (refCounts.get(number) ?? 0) + 1;
  refCounts.set(number, k);
  return `<sup class="footnote-ref"><a href="#fn-${renderTag}-${number}" id="fnref-${renderTag}-${number}-${k}" data-footnote="${number}">${number}</a></sup>`;
}

const footnoteRef: TokenizerAndRendererExtension = {
  name: 'footnoteRef',
  level: 'inline',
  start: (src: string) => src.indexOf('[^'),
  tokenizer(src: string) {
    const m = FOOTNOTE_REF.exec(src);
    if (!m || !footnotes) return undefined;
    const entry = footnotes.entries.find((e) => e.kind === 'named' && e.id === m[1]);
    // An id nothing defines stays the characters that were typed.
    if (!entry) return undefined;
    return { type: 'footnoteRef', raw: m[0], number: entry.number };
  },
  renderer(token) {
    return refHtml(token.number as number);
  },
};

/** `^[words]`, balanced, escapes honoured; null when the brackets never close. */
function inlineNoteAt(src: string): string | null {
  if (!src.startsWith('^[')) return null;
  let depth = 0;
  for (let j = 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '\n') return null;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return src.slice(0, j + 1);
    }
  }
  return null;
}

const footnoteInline: TokenizerAndRendererExtension = {
  name: 'footnoteInline',
  level: 'inline',
  start: (src: string) => src.indexOf('^['),
  tokenizer(src: string) {
    const raw = inlineNoteAt(src);
    if (!raw || !footnotes) return undefined;
    // The scan numbered every inline note in source order; they are drawn in
    // that order too, so the next undrawn one is this one.
    const inline = footnotes.entries.filter((e) => e.kind === 'inline');
    const entry = inline[inlinesDrawn];
    if (!entry) return undefined;
    inlinesDrawn++;
    return { type: 'footnoteInline', raw, number: entry.number };
  },
  renderer(token) {
    return refHtml(token.number as number);
  },
};

/** The endnotes: every numbered footnote, its words, and a way back to each reference. */
function footnotesHtml(): string {
  if (!footnotes || footnotes.entries.length === 0) return '';
  const items = footnotes.entries.map((e) => {
    const text = e.kind === 'named' ? e.def.text : e.note.text;
    let body = markdown.parser(markdown.lexer(text)).trim();
    if (!renderOptions.paper) {
      const count = refCounts.get(e.number) ?? 1;
      const backs = Array.from({ length: count }, (_, i) => {
        const k = i + 1;
        return `<a class="footnote-back" href="#fnref-${renderTag}-${e.number}-${k}" aria-label="Back to reference ${k} of footnote ${e.number}">↩</a>`;
      }).join('');
      // Inside the last paragraph, so the arrow sits at the end of the words.
      body = body.endsWith('</p>') ? `${body.slice(0, -4)} ${backs}</p>` : `${body} ${backs}`;
    }
    const id = e.kind === 'named' ? ` data-footnote-id="${escapeHtml(e.id)}"` : ' data-footnote-inline=""';
    return `<li id="fn-${renderTag}-${e.number}" class="footnote"${id}>${body}</li>`;
  });
  return `<section class="footnotes"><span class="footnotes-label u">Footnotes</span><ol class="footnotes-list">${items.join('\n')}</ol></section>\n`;
}

/**
 * The source with every defined, referred-to definition taken out: those are
 * drawn at the end. A definition nothing refers to, and a second definition of
 * an id, stay where they were written, as the ordinary words they are.
 */
function withoutDefinitions(source: string, scan: FootnoteScan): string {
  const drawn = new Set(scan.entries.flatMap((e) => (e.kind === 'named' ? [e.def] : [])));
  const lines = source.split('\n');
  const skip = new Set<number>();
  for (const d of drawn) for (let i = d.start; i < d.end; i++) skip.add(i);
  // A definition left in place would be read by marked as a link reference
  // definition (`[label]: url`) and vanish; escaping the bracket keeps it the
  // words that were written.
  const shown = new Set([...scan.unreferenced, ...scan.duplicates].map((d) => d.start));
  const keep: string[] = [];
  lines.forEach((l, i) => {
    if (skip.has(i)) return;
    keep.push(shown.has(i) ? l.replace('[', '\\[') : l);
  });
  return keep.join('\n');
}

// --- attachments ------------------------------------------------------------

// A link to an attachment alone on its line: `[report.pdf](note-asset://….pdf)`.
const ATTACHMENT_LINE = /^ {0,3}\[([^\]\n]+)\]\((note-asset:\/\/[^)\s]+)\)[ \t]*(?:\n+|$)/;

/** The chip for an attachment: its name and, once the window or the export knows it, its size. */
function chipHtml(name: string, text: string, link: boolean): string {
  const inner = `<span class="attachment-name">${escapeHtml(text)}</span><span class="attachment-size" data-asset-size="${name}"></span>`;
  return link ? `<a class="attachment attachment-chip" href="${assetUrl(name)}" data-asset="${name}">${inner}</a>` : `<span class="attachment attachment-chip" data-asset="${name}">${inner}</span>`;
}

const attachment: TokenizerAndRendererExtension = {
  name: 'attachment',
  level: 'block',
  // Newline-anchored for the reason the callout's is: `![cat](note-asset://…)`
  // seen one character in looks like this, and must not cut its paragraph.
  start: (src: string) => {
    const m = /\n {0,3}\[[^\]\n]+\]\(note-asset:/.exec(src);
    return m ? m.index + 1 : -1;
  },
  tokenizer(src: string) {
    const m = ATTACHMENT_LINE.exec(src);
    if (!m) return undefined;
    const name = assetNameFromUrl(m[2]);
    if (!name) return undefined;
    return { type: 'attachment', raw: m[0], text: m[1], name };
  },
  renderer(token) {
    const name = token.name as string;
    const text = token.text as string;
    const kind = assetKind(name);
    const paper = renderOptions.paper === true;
    if (paper || kind === 'file' || kind === 'image') return `<p>${chipHtml(name, text, !paper)}</p>\n`;
    const url = assetUrl(name);
    const player =
      kind === 'pdf'
        ? `<iframe class="attachment-frame" src="${url}" title="${escapeHtml(text)}"></iframe>`
        : kind === 'audio'
          ? `<audio class="attachment-player" controls preload="none" src="${url}"></audio>`
          : `<video class="attachment-player" controls preload="none" src="${url}"></video>`;
    return `<figure class="attachment-figure attachment-${kind}" data-asset="${name}">${chipHtml(name, text, true)}${player}</figure>\n`;
  },
};

/** The one marked instance, configured once. */
export const markdown = marked.setOptions({ gfm: true, breaks: true, async: false });

markdown.use({
  extensions: [callout, attachment, embed, wikilink, footnoteRef, footnoteInline, blockMath, inlineMath],
  renderer: {
    // A link to an attachment written mid-sentence stays a link, and is marked
    // so the window can open the file rather than try to navigate to it.
    link({ href, title, tokens }: Tokens.Link) {
      const name = assetNameFromUrl(href);
      const text = this.parser.parseInline(tokens);
      if (!name) {
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href)}"${t}>${text}</a>`;
      }
      if (renderOptions.paper) return `<span class="attachment-link" data-asset="${name}">${text}</span>`;
      return `<a class="attachment-link" href="${assetUrl(name)}" data-asset="${name}">${text}</a>`;
    },
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
export function parseMarkdown(source: string, embeds?: EmbedSource, options: RenderOptions = {}): string {
  embedSource = embeds ?? null;
  embedding.length = 0;
  renderOptions = options;
  // Block addresses are how the source says where a link may point; they
  // are not something to read. The editor keeps them visible because they
  // are the file's own characters — every rendered surface takes them off.
  const text = withoutMarkers(source);
  const scan = scanFootnotes(text);
  footnotes = scan.entries.length > 0 ? scan : null;
  refCounts = new Map();
  inlinesDrawn = 0;
  renderTag = (++renders).toString(36);
  try {
    const hasDefs = scan.defs.length > 0 || scan.duplicates.length > 0;
    const html = markdown.parse(hasDefs ? withoutDefinitions(text, scan) : text, { async: false }) as string;
    return html + footnotesHtml();
  } finally {
    embedSource = null;
    embedding.length = 0;
    footnotes = null;
    renderOptions = {};
  }
}

/** The footnotes of a body as the preview numbers them. */
export { scanFootnotes };

/** Whether rendered HTML holds any KaTeX output, so a page only carries the math stylesheet when it needs it. */
export const hasMath = (html: string): boolean => html.includes('class="katex');

/** Whether rendered HTML still holds an undrawn diagram. */
export const hasDiagrams = (html: string): boolean => html.includes('data-diagram');
