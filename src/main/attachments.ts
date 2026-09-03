import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAttachments, IMAGE_EXTENSIONS } from '../core/attachments';
import { ASSET_SCHEME, assetNameFromUrl } from '../shared/assets';

/** The app's attachments folder. Saving bytes and sweeping orphans live in core/attachments.ts. */
export const attachments = createAttachments(app.getPath('userData'));

export const attachmentsDir = (): string => attachments.dir;
export const { saveAttachment, sweepOrphans } = attachments;

/** Must run before app.whenReady(). */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { secure: true, supportFetchAPI: true } }]);
}

/** Serves note-asset://<name> from the attachments folder; anything else is a 404. */
export function installAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = assetNameFromUrl(request.url);
    if (!name) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(attachments.dir, name)).toString());
  });
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
