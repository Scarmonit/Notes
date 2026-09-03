/**
 * Attached images live in <userData>/attachments and are referenced from note
 * bodies as `note-asset://<name>`. Names are random hex plus an image
 * extension, so anything else in a URL is rejected before it reaches the disk.
 */

export const ASSET_SCHEME = 'note-asset';

const SAFE_NAME = /^[a-f0-9]{8,32}\.(?:png|jpe?g|gif|webp|bmp)$/i;
const REF = new RegExp(`${ASSET_SCHEME}:\\/\\/([A-Za-z0-9_.-]+)`, 'g');

export function isSafeAssetName(name: string): boolean {
  return SAFE_NAME.test(name);
}

export function assetUrl(name: string): string {
  return `${ASSET_SCHEME}://${name}`;
}

/** The file name inside a note-asset URL, or null when the URL is not one we would serve. */
export function assetNameFromUrl(url: string): string | null {
  const prefix = `${ASSET_SCHEME}://`;
  if (!url.toLowerCase().startsWith(prefix)) return null;
  let rest = url
    .slice(prefix.length)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return isSafeAssetName(rest) ? rest : null;
}

/** Unique attachment names referenced by a note body, in order of appearance. */
export function assetRefs(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(REF)) {
    const name = match[1];
    if (isSafeAssetName(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Replaces every note-asset URL with whatever `to` returns for its file name. */
export function rewriteAssetLinks(body: string, to: (name: string) => string): string {
  return body.replace(REF, (whole, name: string) => (isSafeAssetName(name) ? to(name) : whole));
}

/** A Windows-safe file name for an export, from the note title. */
export function exportFileName(title: string, ext: string): string {
  const clean = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim();
  return `${clean || 'Note'}.${ext}`;
}
