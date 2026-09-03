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
  /**
   * Deletes pictures no note mentions any more, once they have gone
   * unmentioned for the grace period. `alsoReferenced` supplies bodies that
   * are not in the file but still count — the notes in the trash, which
   * come back with their pictures.
   */
  sweepOrphans(file: NotesFile, alsoReferenced?: () => Promise<string[]>): Promise<void>;
  /** Writes a markdown export, with the images it mentions copied into a folder beside it. */
  writeMarkdownExport(filePath: string, body: string): Promise<void>;
  /** Rendered HTML with every note-asset image inlined as a data URI, so one file carries the whole note. */
  inlineAssets(html: string): Promise<string>;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

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

  // When each picture was first seen with no note mentioning it. The grace
  // period runs from then, not from when the picture was attached: an image
  // cut from one note and pasted into another a minute later, or a deleted
  // note restored from the trash, must find its picture still there.
  const unmentionedSince = new Map<string, number>();

  async function sweepOrphans(file: NotesFile, alsoReferenced?: () => Promise<string[]>): Promise<void> {
    const referenced = new Set(file.notes.flatMap((n) => assetRefs(n.body)));
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const now = Date.now();
    const cutoff = now - ORPHAN_GRACE_MS;
    const candidates: string[] = [];
    for (const name of entries) {
      if (referenced.has(name)) {
        unmentionedSince.delete(name);
        continue;
      }
      const since = unmentionedSince.get(name) ?? now;
      unmentionedSince.set(name, since);
      if (since < cutoff) candidates.push(name);
    }
    for (const name of unmentionedSince.keys()) if (!entries.includes(name)) unmentionedSince.delete(name);
    if (candidates.length === 0) return;
    const stillSpokenFor = new Set(((await alsoReferenced?.()) ?? []).flatMap(assetRefs));
    for (const name of candidates) {
      if (stillSpokenFor.has(name)) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(full).catch(() => undefined);
        unmentionedSince.delete(name);
      }
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

  async function inlineAssets(html: string): Promise<string> {
    const refs = assetRefs(html);
    if (refs.length === 0) return html;
    const data = new Map<string, string>();
    for (const name of refs) {
      const bytes = await fs.readFile(path.join(dir, name)).catch(() => null);
      if (bytes) data.set(name, `data:${MIME[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`);
    }
    return rewriteAssetLinks(html, (name) => data.get(name) ?? assetUrl(name));
  }

  return { dir, saveAttachment, sweepOrphans, writeMarkdownExport, inlineAssets };
}
