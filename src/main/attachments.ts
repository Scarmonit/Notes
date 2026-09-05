import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAttachments, IMAGE_EXTENSIONS } from '../core/attachments';
import { ASSET_SCHEME, assetNameFromUrl, canOpenAsset } from '../shared/assets';
import type { PickedAttachment } from '../shared/types';

/** The app's attachments folder. Saving bytes and sweeping orphans live in core/attachments.ts. */
export const attachments = createAttachments(app.getPath('userData'));

export const attachmentsDir = (): string => attachments.dir;
export const { saveAttachment, sweepOrphans } = attachments;

/** Must run before app.whenReady(). */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } }]);
}

/** Serves note-asset://<name> from the attachments folder; anything else is a 404. */
export function installAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = assetNameFromUrl(request.url);
    const full = name ? attachments.pathOf(name) : null;
    if (!full) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString(), { headers: request.headers });
  });
}

/** Any file may be attached; the Images preset is there because pictures are still what is attached most. */
export async function pickAttachments(win: BrowserWindow): Promise<PickedAttachment[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Attach a file',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
    ],
  });
  if (canceled) return [];
  const picked: PickedAttachment[] = [];
  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    picked.push({ url: await saveAttachment(new Uint8Array(await fs.readFile(filePath)), name), name });
  }
  return picked;
}

/**
 * Opens an attachment in whatever Windows opens that kind of file with. Only a
 * name the store recognises, inside the attachments folder, of a kind on the
 * allow-list: an executable that was attached stays a file, never a program.
 * Resolves to an empty string when it opened, else the reason it did not.
 */
export async function openAttachment(name: string): Promise<string> {
  const full = attachments.pathOf(name);
  if (!full) return 'That is not an attachment of this notebook';
  if (!canOpenAsset(name)) return 'This kind of file is not opened from Notes';
  const stat = await fs.stat(full).catch(() => null);
  if (!stat || !stat.isFile()) return 'Missing attachment';
  return shell.openPath(full);
}

/** The size of each attachment named; null where the file is gone. */
export const assetSizes = (names: string[]): Promise<Record<string, number | null>> => attachments.sizesOf(names.filter((n) => typeof n === 'string'));
