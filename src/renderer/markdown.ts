import DOMPurify from 'dompurify';
import { marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { LINK_PATTERN } from './notes';
import { highlightCode } from './highlight';

marked.use({ gfm: true, breaks: true });

function escapeHtml(s: string): string {
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

marked.use({
  extensions: [wikilink],
  renderer: {
    // Code is highlighted here, before sanitising, so the spans the
    // highlighter adds are checked like any other markup in the note.
    code({ text, lang }: Tokens.Code) {
      const { html, language } = highlightCode(text, lang ?? '');
      const name = language ? ` language-${language}` : '';
      return `<pre><code class="hljs${name}">${html}</code></pre>\n`;
    },
  },
});

// Every link in a note leaves the app: the main process turns target=_blank
// window opens into shell.openExternal calls.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// DOMPurify's default only lets http(s)/mailto/tel through on src/href; attached
// images use the app's own note-asset scheme, which the main process serves
// from the attachments folder and nowhere else.
const ALLOWED_URI = /^(?:(?:https?|mailto|note-asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** Markdown source to sanitized HTML, safe to assign to innerHTML. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'], ALLOWED_URI_REGEXP: ALLOWED_URI });
}
