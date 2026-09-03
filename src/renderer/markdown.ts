import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: true });

// Every link in a note leaves the app: the main process turns target=_blank
// window opens into shell.openExternal calls.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Markdown source to sanitized HTML, safe to assign to innerHTML. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
}
