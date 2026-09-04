import DOMPurify from 'dompurify';
import { parseMarkdown, type EmbedSource } from '../shared/markdown-core';

/**
 * The preview's HTML: the shared markdown core, then DOMPurify. Math comes
 * out of KaTeX as HTML with MathML beside it, and a drawn diagram is SVG,
 * so both of those profiles are allowed through; the window draws the
 * diagrams itself, after this, straight into the DOM (see diagrams.ts).
 */

// Every link in a note leaves the app: the main process turns target=_blank
// window opens into shell.openExternal calls.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// A stylesheet in a note would apply to the whole window, not the note:
// `<style>` goes, and a style attribute (KaTeX needs those for its layout)
// may not load anything or run anything.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style' && /url\s*\(|@import|expression\s*\(|behavior\s*:/i.test(data.attrValue)) data.keepAttr = false;
});

// DOMPurify's default only lets http(s)/mailto/tel through on src/href; attached
// images use the app's own note-asset scheme, which the main process serves
// from the attachments folder and nowhere else.
const ALLOWED_URI = /^(?:(?:https?|mailto|note-asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** Markdown source to sanitized HTML, safe to assign to innerHTML. */
export function renderMarkdown(source: string, embeds?: EmbedSource): string {
  const html = parseMarkdown(source, embeds);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
    ADD_ATTR: ['target', 'data-diagram', 'data-link'],
    FORBID_TAGS: ['style'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

/**
 * The same, cut down for a glance.
 *
 * A peek must not cost what the preview costs: no mermaid import, no
 * highlighting pass, no typesetting, and above all no embeds — a hover that
 * expanded an embed would render a second note, and that one's embeds after
 * it. What is dropped is dropped visibly: a diagram says it is a diagram, an
 * embed says what it would have shown.
 */
export function renderGlance(source: string): string {
  const plain = source
    // A fence keeps its words and loses its colours.
    .replace(/^([ \t]*)```mermaid[^\n]*\n[\s\S]*?^\1```[ \t]*$/gm, '$1`Mermaid diagram`\n')
    // An embed is named, not followed.
    .replace(/^!\[\[([^\[\]\n]+)\]\][ \t]*$/gm, (_m, inner: string) => `\`Embedded: ${inner.split('|')[0].trim()}\``);
  // No embed source at all: an unresolved `![[…]]` past the rewrite above is
  // one written mid-line, and drawing it as an empty embed is the honest answer.
  return renderMarkdown(plain);
}
