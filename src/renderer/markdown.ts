import DOMPurify from 'dompurify';
import { parseMarkdown } from '../shared/markdown-core';

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

// DOMPurify's default only lets http(s)/mailto/tel through on src/href; attached
// images use the app's own note-asset scheme, which the main process serves
// from the attachments folder and nowhere else.
const ALLOWED_URI = /^(?:(?:https?|mailto|note-asset):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/** Markdown source to sanitized HTML, safe to assign to innerHTML. */
export function renderMarkdown(source: string): string {
  const html = parseMarkdown(source);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
    ADD_ATTR: ['target', 'data-diagram', 'data-link'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}
