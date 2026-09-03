import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assetRefs, assetUrl, rewriteAssetLinks } from '../shared/assets';
import type { NotesFile } from '../shared/types';
import { pathsFor } from './paths';

/**
 * The file half of attachments: bytes in, a note-asset URL out, and the
 * sweep that removes what no note mentions any more. Serving the URLs to the
 * window is the main process's business and stays there.
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** Image type from the file's own bytes, so a mislabelled file cannot lie. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

// An image that no note references any more is deleted, but only once it has
// sat unreferenced for a while: a freshly pasted image is written to disk a
// moment before the note body that mentions it is saved.
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

export interface Attachments {
  readonly dir: string;
  saveAttachment(bytes: Uint8Array, originalName: string): Promise<string>;
  sweepOrphans(file: NotesFile): Promise<void>;
  /** Writes a markdown export, with the images it mentions copied into a folder beside it. */
  writeMarkdownExport(filePath: string, body: string): Promise<void>;
}

export function createAttachments(root: string): Attachments {
  const dir = pathsFor(root).attachments;

  async function saveAttachment(bytes: Uint8Array, originalName: string): Promise<string> {
    const ext = sniffImage(bytes);
    if (!ext) {
      const claimed = path.extname(originalName).slice(1).toLowerCase();
      const hint = IMAGE_EXTENSIONS.includes(claimed) ? ' (the file does not look like a valid image)' : '';
      throw new Error(`Only PNG, JPEG, GIF, WebP and BMP images can be attached${hint}`);
    }
    const name = `${randomBytes(8).toString('hex')}.${ext}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), bytes);
    return assetUrl(name);
  }

  async function sweepOrphans(file: NotesFile): Promise<void> {
    const referenced = new Set(file.notes.flatMap((n) => assetRefs(n.body)));
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    for (const name of entries) {
      if (referenced.has(name)) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.isFile() && stat.mtimeMs < cutoff) await fs.unlink(full).catch(() => undefined);
    }
  }

  /**
   * Attached images travel with the .md in a "<name>_files" folder beside it,
   * with links rewritten to relative paths, the way browsers save a page.
   */
  async function writeMarkdownExport(filePath: string, body: string): Promise<void> {
    const refs = assetRefs(body);
    if (refs.length === 0) {
      await fs.writeFile(filePath, body, 'utf8');
      return;
    }
    const folderName = `${path.basename(filePath, path.extname(filePath))}_files`;
    const folder = path.join(path.dirname(filePath), folderName);
    await fs.mkdir(folder, { recursive: true });
    for (const name of refs) {
      await fs.copyFile(path.join(dir, name), path.join(folder, name)).catch(() => undefined);
    }
    const href = encodeURI(folderName);
    await fs.writeFile(filePath, rewriteAssetLinks(body, (name) => `${href}/${name}`), 'utf8');
  }

  return { dir, saveAttachment, sweepOrphans, writeMarkdownExport };
}
