/**
 * Attachments live in <notes root>/attachments and are referenced from note
 * bodies as `note-asset://<name>`. Names are random hex plus an extension, so
 * anything else in a URL is rejected before it reaches the disk. Since 0.28
 * any kind of file may be attached: an image is drawn, a PDF or a piece of
 * media is played, and everything else is a link that opens in its own app.
 */

export const ASSET_SCHEME = 'note-asset';

const SAFE_NAME = /^[a-f0-9]{8,32}\.[a-z0-9]{1,16}$/i;
const REF = new RegExp(`${ASSET_SCHEME}:\\/\\/([A-Za-z0-9_.-]+)`, 'g');

export function isSafeAssetName(name: string): boolean {
  return SAFE_NAME.test(name);
}

/** What an attachment is, by its extension — which the store chose from the file's own bytes where it could. */
export type AssetKind = 'image' | 'pdf' | 'audio' | 'video' | 'file';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac']);
const VIDEO_EXT = new Set(['mp4', 'webm']);

export const assetExtension = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

export function assetKind(name: string): AssetKind {
  const ext = assetExtension(name);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'file';
}

export const isImageAsset = (name: string): boolean => isSafeAssetName(name) && assetKind(name) === 'image';

/**
 * The kinds of file the app will hand to Windows to open: everything verified
 * from its bytes, and the document formats a reader expects to open. An
 * executable or a script can be attached but is never launched from here.
 */
const OPENABLE = new Set([...IMAGE_EXT, 'pdf', ...AUDIO_EXT, ...VIDEO_EXT, 'txt', 'md', 'csv', 'rtf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

export const canOpenAsset = (name: string): boolean => isSafeAssetName(name) && OPENABLE.has(assetExtension(name));

/** An attachment link as written in a line: `[report.pdf](note-asset://….pdf)`, image or not. */
export interface AttachmentLink {
  name: string;
  text: string;
  start: number;
  end: number;
}

const LINK_IN_LINE = new RegExp(`!?\\[([^\\]\\n]*)\\]\\((${ASSET_SCHEME}:\\/\\/[^)\\s]+)\\)`, 'g');

/** Every attachment link on a line, with where it sits. */
export function attachmentLinksIn(line: string): AttachmentLink[] {
  const out: AttachmentLink[] = [];
  for (const m of line.matchAll(LINK_IN_LINE)) {
    const name = assetNameFromUrl(m[2]);
    if (name) out.push({ name, text: m[1], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The attachment link a column of a line falls inside, or null. */
export function attachmentLinkAt(line: string, col: number): AttachmentLink | null {
  return attachmentLinksIn(line).find((l) => col >= l.start && col <= l.end) ?? null;
}

/** The markdown for a link to an attachment: the file's own name as the words, escaped where it must be. */
export function attachmentMarkdown(name: string, originalName: string): string {
  const text = (originalName || name).replace(/[\[\]\\]/g, (c) => `\\${c}`).replace(/\s+/g, ' ').trim() || name;
  return `[${text}](${assetUrl(name)})`;
}

/** A file size as people read one: `1.2 MB`, `640 KB`, `12 B`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
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
