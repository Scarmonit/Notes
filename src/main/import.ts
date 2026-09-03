import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImportedFile } from '../shared/types';

const TEXT_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt', 'text'];

/** A file bigger than this is not a note someone meant to import. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Opens a picker for markdown and text files and reads the ones chosen. */
export async function pickImports(win: BrowserWindow): Promise<ImportedFile[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import notes',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown and text', extensions: TEXT_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled) return [];
  const out: ImportedFile[] = [];
  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_BYTES) continue;
    out.push({ name: path.basename(filePath), text: await fs.readFile(filePath, 'utf8') });
  }
  return out;
}
