import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assetKind, assetRefs, assetUrl, formatSize, isImageAsset, isSafeAssetName, rewriteAssetLinks } from '../shared/assets';
import type { NotesFile } from '../shared/types';
import { pathsFor } from './paths';

/**
 * The file half of attachments: bytes in, a note-asset URL out, and the
 * sweep that removes what no note mentions any more. Serving the URLs to the
 * window is the main process's business and stays there.
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** The most a single attachment may be: 50 MiB. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

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

const ascii = (b: Uint8Array, at: number, text: string): boolean => Array.from(text).every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * The kinds the window will draw or play, told from the bytes: a PDF, the
 * common sound and video containers. Only a file that proves what it is gets
 * a frame or a player; a file that merely says so in its name is a plain link.
 */
export function sniffMedia(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, '%PDF')) return 'pdf';
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return 'mp3';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'wav';
  if (ascii(b, 0, 'OggS')) return 'ogg';
  if (ascii(b, 0, 'fLaC')) return 'flac';
  if (ascii(b, 4, 'ftyp')) return 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
}

/** The extension an attachment is stored under: what the bytes say, else what the name says, else `bin`. */
export function extensionFor(bytes: Uint8Array, originalName: string): string {
  const sniffed = sniffImage(bytes) ?? sniffMedia(bytes);
  if (sniffed) return sniffed;
  const claimed = path.extname(originalName).slice(1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(claimed) ? claimed : 'bin';
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
  /**
   * Writes a markdown export, with every attachment it mentions copied into a
   * folder beside it. Resolves to the names of any that were not there to copy.
   */
  writeMarkdownExport(filePath: string, body: string): Promise<string[]>;
  /** Rendered HTML with every note-asset image inlined as a data URI, so one file carries the whole note. */
  inlineAssets(html: string): Promise<string>;
  /**
   * Rendered HTML with every attachment that is not an image copied into a
   * folder beside `filePath` and linked relatively, the way a saved web page
   * keeps its files. Resolves to the HTML and the names that were missing.
   */
  writeSidecars(html: string, filePath: string): Promise<{ html: string; missing: string[] }>;
  /** Rendered HTML with each attachment's size written where the core left room for it. */
  fillSizes(html: string): Promise<string>;
  /** The size in bytes of each attachment named, or null for one that is not there. */
  sizesOf(names: readonly string[]): Promise<Record<string, number | null>>;
  /** The full path of an attachment, checked to be inside the folder; null for a name that is not one. */
  pathOf(name: string): string | null;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** Where the core left room for an attachment's size. */
const SIZE_SLOT = /<span class="attachment-size" data-asset-size="([^"]+)"><\/span>/g;

export function createAttachments(root: string): Attachments {
  const dir = pathsFor(root).attachments;

  async function saveAttachment(bytes: Uint8Array, originalName: string): Promise<string> {
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${originalName || 'That file'} is larger than 50 MB, the most one attachment may be`);
    if (bytes.length === 0) throw new Error(`${originalName || 'That file'} is empty`);
    const ext = extensionFor(bytes, originalName);
    const name = `${randomBytes(8).toString('hex')}.${ext}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), bytes);
    return assetUrl(name);
  }

  function pathOf(name: string): string | null {
    if (!isSafeAssetName(name)) return null;
    const full = path.resolve(dir, name);
    return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
  }

  async function sizesOf(names: readonly string[]): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const name of names) {
      const full = pathOf(name);
      const stat = full ? await fs.stat(full).catch(() => null) : null;
      out[name] = stat && stat.isFile() ? stat.size : null;
    }
    return out;
  }

  async function fillSizes(html: string): Promise<string> {
    const names = Array.from(html.matchAll(SIZE_SLOT), (m) => m[1]);
    if (names.length === 0) return html;
    const sizes = await sizesOf(names);
    return html.replace(SIZE_SLOT, (_m, name: string) => {
      const size = sizes[name];
      return size === null || size === undefined ? `<span class="attachment-size attachment-missing" data-asset-size="${name}">Missing attachment</span>` : `<span class="attachment-size" data-asset-size="${name}">${formatSize(size)}</span>`;
    });
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
  /** Copies the attachments named into `<export>_files/` beside the export; the names not there to copy come back. */
  async function copyBeside(filePath: string, names: readonly string[]): Promise<{ folderName: string; missing: string[] }> {
    const folderName = `${path.basename(filePath, path.extname(filePath))}_files`;
    const folder = path.join(path.dirname(filePath), folderName);
    const missing: string[] = [];
    if (names.length > 0) await fs.mkdir(folder, { recursive: true });
    for (const name of names) {
      const ok = await fs
        .copyFile(path.join(dir, name), path.join(folder, name))
        .then(() => true)
        .catch(() => false);
      if (!ok) missing.push(name);
    }
    return { folderName, missing };
  }

  async function writeMarkdownExport(filePath: string, body: string): Promise<string[]> {
    const refs = assetRefs(body);
    if (refs.length === 0) {
      await fs.writeFile(filePath, body, 'utf8');
      return [];
    }
    const { folderName, missing } = await copyBeside(filePath, refs);
    const href = encodeURI(folderName);
    await fs.writeFile(filePath, rewriteAssetLinks(body, (name) => `${href}/${name}`), 'utf8');
    return missing;
  }

  async function inlineAssets(html: string): Promise<string> {
    const refs = assetRefs(html).filter(isImageAsset);
    if (refs.length === 0) return html;
    const data = new Map<string, string>();
    for (const name of refs) {
      const bytes = await fs.readFile(path.join(dir, name)).catch(() => null);
      if (bytes) data.set(name, `data:${MIME[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`);
    }
    return rewriteAssetLinks(html, (name) => data.get(name) ?? assetUrl(name));
  }

  async function writeSidecars(html: string, filePath: string): Promise<{ html: string; missing: string[] }> {
    const refs = assetRefs(html).filter((name) => assetKind(name) !== 'image');
    if (refs.length === 0) return { html, missing: [] };
    const { folderName, missing } = await copyBeside(filePath, refs);
    const href = encodeURI(folderName);
    const copied = new Set(refs.filter((n) => !missing.includes(n)));
    return { html: rewriteAssetLinks(html, (name) => (copied.has(name) ? `${href}/${name}` : assetUrl(name))), missing };
  }

  return { dir, saveAttachment, sweepOrphans, writeMarkdownExport, inlineAssets, writeSidecars, fillSizes, sizesOf, pathOf };
}
