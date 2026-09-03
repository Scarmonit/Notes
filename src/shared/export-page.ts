import { escapeHtml, hasMath } from './markdown-core';

/**
 * The page an exported note is laid on, for the PNG and PDF renders and
 * the standalone HTML file: the note as the preview shows it, inside the
 * app's own stylesheet, with the edit time in the margin. One function, so
 * the three cannot come out looking different.
 */
export interface ExportPageOptions {
  title: string;
  /** The rendered, sanitised article. */
  html: string;
  /** The app's stylesheet, inlined. */
  css: string;
  /** KaTeX's stylesheet with its fonts inlined; added only when the note has math. */
  mathCss?: string;
  /** What the margin says: "Edited 3 Sep 2026, 14:07". */
  edited: string;
  /** Paper: the light rendering for print and PDF. Ink: the app's own look. */
  look: 'ink' | 'paper';
  /** Fixed width in px (the PNG), or none (a fluid HTML page / the PDF's own page). */
  width?: number;
}

export function exportPage(options: ExportPageOptions): string {
  const styles = [`<style>${options.css}</style>`];
  if (options.mathCss && hasMath(options.html)) styles.push(`<style>${options.mathCss}</style>`);
  if (options.width !== undefined) styles.push(`<style>.export-card{width:${options.width}px}</style>`);
  return (
    `<!doctype html><html class="export ${options.look}" lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(options.title)}</title>${styles.join('')}</head>` +
    `<body><div class="export-card"><aside class="export-margin"><span class="u">${escapeHtml(options.edited)}</span></aside>` +
    `<article class="markdown">${options.html}</article></div></body></html>`
  );
}
