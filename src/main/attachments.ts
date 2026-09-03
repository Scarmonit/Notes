import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME, assetNameFromUrl, assetRefs, assetUrl } from '../shared/assets';
import type { NotesFile } from '../shared/types';

export function attachmentsDir(): string {
  return path.join(app.getPath('userData'), 'attachments');
}

/** Must run before app.whenReady(). */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { secure: true, supportFetchAPI: true } }]);
}

/** Serves note-asset://<name> from the attachments folder; anything else is a 404. */
export function installAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = assetNameFromUrl(request.url);
    if (!name) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(attachmentsDir(), name)).toString());
  });
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** Image type from the file's own bytes, so a mislabelled file cannot lie. */
function sniff(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

export async function saveAttachment(bytes: Uint8Array, originalName: string): Promise<string> {
  const ext = sniff(bytes);
  if (!ext) {
    const claimed = path.extname(originalName).slice(1).toLowerCase();
    const hint = IMAGE_EXTENSIONS.includes(claimed) ? ' (the file does not look like a valid image)' : '';
    throw new Error(`Only PNG, JPEG, GIF, WebP and BMP images can be attached${hint}`);
  }
  const name = `${randomBytes(8).toString('hex')}.${ext}`;
  await fs.mkdir(attachmentsDir(), { recursive: true });
  await fs.writeFile(path.join(attachmentsDir(), name), bytes);
  return assetUrl(name);
}

export async function pickAttachments(win: BrowserWindow): Promise<string[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Attach images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  });
  if (canceled) return [];
  const urls: string[] = [];
  for (const filePath of filePaths) {
    urls.push(await saveAttachment(new Uint8Array(await fs.readFile(filePath)), path.basename(filePath)));
  }
  return urls;
}

// An image that no note references any more is deleted, but only once it has
// sat unreferenced for a while: a freshly pasted image is written to disk a
// moment before the note body that mentions it is saved.
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

export async function sweepOrphans(file: NotesFile): Promise<void> {
  const referenced = new Set(file.notes.flatMap((n) => assetRefs(n.body)));
  const dir = attachmentsDir();
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
