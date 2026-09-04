import { parseMarkdown } from '../shared/markdown-core';
import { embedsFrom } from './embeds';
import type { Note } from '../shared/types';

/**
 * Rendering for the command line with the app closed: the same markdown
 * core as the window, without DOMPurify, which needs a DOM. What comes out
 * is the person's own notes on their own machine, written to a file they
 * asked for; the window still sanitises everything it shows. Diagrams stay
 * as their source here — mermaid needs a browser to draw — and are drawn
 * when the export goes through the running app instead.
 */
export function renderHtmlOffline(body: string, notes: Note[] = []): string {
  return parseMarkdown(body, embedsFrom(notes));
}
