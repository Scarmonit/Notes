import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exportFileName } from '../shared/assets';
import { exportPage } from '../shared/export-page';
import type { ExportRequest, RenderedExport } from '../shared/types';
import { attachments } from './attachments';

const FILTERS = {
  md: [{ name: 'Markdown', extensions: ['md'] }],
  txt: [{ name: 'Plain text', extensions: ['txt'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
  html: [{ name: 'Web page', extensions: ['html'] }],
  pdf: [{ name: 'PDF document', extensions: ['pdf'] }],
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
    case 'html':
      // One self-contained file: the page the PNG is drawn from, with the
      // pictures inlined, at whatever width the window that opens it has.
      await fs.writeFile(filePath, await pageFor(request, 'ink'), 'utf8');
      break;
    case 'pdf':
      await fs.writeFile(filePath, await renderPdf(request));
      break;
  }
}

const PNG_WIDTH = 820;
const PNG_SCALE = 2;

/** The export page for a rendered note, pictures inlined. */
async function pageFor(request: RenderedExport, look: 'ink' | 'paper', width?: number): Promise<string> {
  const html = await attachments.inlineAssets(request.html);
  return exportPage({ title: request.title, html, css: request.css, mathCss: request.mathCss, edited: request.edited, look, width });
}

/** A hidden window showing an export page, ready for capture or print. */
async function openPage(doc: string, options: { width: number; offscreen: boolean }): Promise<{ win: BrowserWindow; done: () => Promise<void> }> {
  const tmp = path.join(app.getPath('temp'), `notes-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  await fs.writeFile(tmp, doc, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: options.width,
    height: 600,
    webPreferences: { offscreen: options.offscreen, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const done = async (): Promise<void> => {
    win.destroy();
    await fs.unlink(tmp).catch(() => undefined);
  };
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('Promise.all(Array.from(document.images, (i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))');
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
  } catch (err) {
    await done();
    throw err;
  }
  return { win, done };
}

/**
 * Draws the note the way the preview shows it, in a hidden offscreen window
 * using the renderer's own stylesheet, and captures it at 2x.
 */
async function renderPng(request: RenderedExport): Promise<Buffer> {
  const { win, done } = await openPage(await pageFor(request, 'ink', PNG_WIDTH), { width: PNG_WIDTH * PNG_SCALE, offscreen: true });
  try {
    win.webContents.setZoomFactor(PNG_SCALE);
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
    await done();
  }
}

/**
 * The same page on paper: light, A4, with the margins a printed document
 * has. Backgrounds are printed so code blocks and diagrams keep their panels.
 */
async function renderPdf(request: RenderedExport): Promise<Buffer> {
  const { win, done } = await openPage(await pageFor(request, 'paper'), { width: 900, offscreen: false });
  try {
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      preferCSSPageSize: false,
    });
  } finally {
    await done();
  }
}
