import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exportFileName } from '../shared/assets';
import type { ExportRequest } from '../shared/types';
import { attachments } from './attachments';

const FILTERS = {
  md: [{ name: 'Markdown', extensions: ['md'] }],
  txt: [{ name: 'Plain text', extensions: ['txt'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
};

/** Shows the Save dialog and writes the export. Resolves to the path, or null when cancelled. */
export async function exportNote(win: BrowserWindow, request: ExportRequest): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export note',
    defaultPath: path.join(app.getPath('documents'), exportFileName(request.title, request.kind)),
    filters: FILTERS[request.kind],
  });
  if (canceled || !filePath) return null;
  await exportTo(filePath, request);
  return filePath;
}

/** Writes an export to a path already chosen: by the dialog, or by the command line. */
export async function exportTo(filePath: string, request: ExportRequest): Promise<void> {
  switch (request.kind) {
    case 'md':
      await attachments.writeMarkdownExport(filePath, request.body);
      break;
    case 'txt':
      await fs.writeFile(filePath, request.text, 'utf8');
      break;
    case 'png':
      await fs.writeFile(filePath, await renderPng(request));
      break;
  }
}

const PNG_WIDTH = 820;
const PNG_SCALE = 2;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/**
 * Draws the note the way the preview shows it, in a hidden offscreen window
 * using the renderer's own stylesheet, and captures it at 2x.
 */
async function renderPng(request: Extract<ExportRequest, { kind: 'png' }>): Promise<Buffer> {
  const doc =
    `<!doctype html><html class="export"><head><meta charset="utf-8"><style>${request.css}</style></head>` +
    `<body><div class="export-card"><aside class="export-margin"><span class="u">${escapeHtml(request.edited)}</span></aside>` +
    `<article class="markdown">${request.html}</article></div></body></html>`;
  const tmp = path.join(app.getPath('temp'), `notes-export-${Date.now()}.html`);
  await fs.writeFile(tmp, doc, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: PNG_WIDTH * PNG_SCALE,
    height: 600,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(tmp);
    win.webContents.setZoomFactor(PNG_SCALE);
    await win.webContents.executeJavaScript(
      'Promise.all(Array.from(document.images, (i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))'
    );
    const cssHeight = (await win.webContents.executeJavaScript('document.documentElement.scrollHeight')) as number;
    win.setContentSize(PNG_WIDTH * PNG_SCALE, Math.max(200, Math.ceil(cssHeight * PNG_SCALE)));
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 600);
      win.webContents.once('paint', () => {
        clearTimeout(fallback);
        setTimeout(resolve, 60);
      });
    });
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.destroy();
    await fs.unlink(tmp).catch(() => undefined);
  }
}
