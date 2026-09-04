/**
 * Folders: where a note lives.
 *
 * A folder is a real directory inside the notes folder, and a note's folder is
 * its relative path and nothing else — never a field in its front matter. The
 * filesystem is the only authority, so a note moved in Explorer, by OneDrive or
 * by `git pull` arrives exactly as one moved in the app.
 *
 * Everywhere above the disk a folder is written the one way: root-relative,
 * separated by `/`, with no leading or trailing slash. The root is the empty
 * string, which is a real place a note can live rather than the absence of one.
 *
 * Unlike `fileNameFor`, which quietly rewrites a title into something Windows
 * will accept, nothing here sanitises: a name that cannot be a directory is
 * refused and the reason is said out loud. A folder is something the user
 * named, and being given a different one silently is worse than being told no.
 */

export const FOLDER_SEP = '/';

/** The root of the notebook: a place, spelt as no path at all. */
export const ROOT_FOLDER = '';

/** What the root is called on screen, where "" would read as nothing. */
export const ROOT_LABEL = 'All notes';

/** The longest a single folder name may be, matching `fileNameFor`'s cap on filenames. */
export const MAX_SEGMENT = 80;

const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;
const ILLEGAL = /[<>:"/\\|?*]/;

/**
 * Why this cannot be one folder's name, or null when it can. The text is shown
 * to the user as it is, so it names the segment and says what is wrong with it.
 */
export function segmentProblem(segment: string): string | null {
  if (!segment) return 'a folder needs a name';
  if (segment === '.' || segment === '..') return `"${segment}" is not a name`;
  if ([...segment].some((c) => c.charCodeAt(0) < 32)) return 'a folder name cannot contain a control character';
  const bad = ILLEGAL.exec(segment);
  if (bad) return `a folder name cannot contain ${bad[0] === '/' ? 'a slash' : `"${bad[0]}"`}`;
  if (/[. ]$/.test(segment)) return `"${segment}" ends in a dot or a space, which Windows will not keep`;
  if (segment.startsWith('.')) return `"${segment}" starts with a dot, which hides it from the app`;
  if (RESERVED.test(segment)) return `"${segment}" is a name Windows reserves`;
  if (segment.length > MAX_SEGMENT) return `"${segment.slice(0, 20)}…" is longer than ${MAX_SEGMENT} characters`;
  return null;
}

/**
 * A folder path as it was typed, tidied but not changed: the slashes evened
 * out, the ends trimmed. Empty means the root.
 */
export function normalizeFolder(text: string): string {
  return text
    .replace(/\\/g, FOLDER_SEP)
    .split(FOLDER_SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(FOLDER_SEP);
}

/** The parts of a folder path, root first. The root has none. */
export function folderSegments(folder: string): string[] {
  return folder ? folder.split(FOLDER_SEP) : [];
}

/** Why this cannot be a folder path, or null when it can. The root is always fine. */
export function folderProblem(folder: string): string | null {
  for (const segment of folderSegments(folder)) {
    const problem = segmentProblem(segment);
    if (problem) return problem;
  }
  return null;
}

/**
 * A folder path from what someone typed: tidied, then checked. The error is a
 * sentence to show them, never a name they did not ask for.
 */
export function parseFolder(text: string): { folder: string } | { error: string } {
  const folder = normalizeFolder(text);
  const problem = folderProblem(folder);
  return problem ? { error: problem } : { folder };
}

/** Windows does not tell folders apart by case, so neither does the app. */
export const folderKey = (folder: string): string => folder.toLowerCase();

/** The folder holding a note file: `Work/Clients/Hale.md` lives in `Work/Clients`. */
export function folderOf(relPath: string): string {
  const at = relPath.lastIndexOf(FOLDER_SEP);
  return at < 0 ? ROOT_FOLDER : relPath.slice(0, at);
}

/** Just the file's own name, without the folders above it. */
export function fileNameOf(relPath: string): string {
  const at = relPath.lastIndexOf(FOLDER_SEP);
  return at < 0 ? relPath : relPath.slice(at + 1);
}

/** A note file's path: the folder, then the name. */
export function joinFolder(folder: string, name: string): string {
  return folder ? `${folder}${FOLDER_SEP}${name}` : name;
}

/** True when `folder` is `under`, or nested inside it. The root holds everything. */
export function folderMatches(folder: string, under: string): boolean {
  if (under === ROOT_FOLDER) return true;
  const a = folderKey(folder);
  const b = folderKey(under);
  return a === b || a.startsWith(`${b}${FOLDER_SEP}`);
}

/** Every folder on the way down to this one, including itself: Work, Work/Clients. */
export function folderPath(folder: string): string[] {
  const parts = folderSegments(folder);
  return parts.map((_, i) => parts.slice(0, i + 1).join(FOLDER_SEP));
}

/** The folder above this one; the root's parent is itself. */
export function parentFolder(folder: string): string {
  return folderOf(folder);
}

/** A folder as it reads on screen: `Work / Clients`, or `All notes` for the root. */
export function folderLabel(folder: string): string {
  return folder ? folderSegments(folder).join(' / ') : ROOT_LABEL;
}

/** The last part of a folder's path, which is its own name. */
export function folderName(folder: string): string {
  const parts = folderSegments(folder);
  return parts.length > 0 ? parts[parts.length - 1] : ROOT_LABEL;
}

/** Moving a folder into itself, or into something it contains, is not a move. */
export function isSelfOrInside(folder: string, maybeInside: string): boolean {
  return folder !== ROOT_FOLDER && folderMatches(maybeInside, folder);
}

export interface FolderNode {
  /** The whole path: Work/Clients. */
  folder: string;
  /** Just this level of it: Clients. */
  label: string;
  /** Notes in this folder and everything beneath it. */
  count: number;
  /** Notes filed directly here. */
  own: number;
  children: FolderNode[];
}

/**
 * The folders as a tree. A note in `Work/Clients/Hale` counts towards `Work`
 * as well, the way a note tagged `#work/clients/hale` counts towards `#work`:
 * a parent stands for its whole branch, or it would read as empty while
 * everything sat inside it.
 *
 * Folders with no notes in them are still folders. `folders` is the directories
 * that exist on disk, which is not the same list as the ones notes are in.
 */
export function folderTree(folders: readonly string[], noteFolders: readonly string[]): FolderNode[] {
  const own = new Map<string, number>();
  const count = new Map<string, number>();
  const known = new Set<string>();
  for (const folder of folders) for (const step of folderPath(folder)) known.add(step);
  for (const folder of noteFolders) {
    if (folder === ROOT_FOLDER) continue;
    for (const step of folderPath(folder)) known.add(step);
    own.set(folder, (own.get(folder) ?? 0) + 1);
    for (const step of folderPath(folder)) count.set(step, (count.get(step) ?? 0) + 1);
  }
  const nodes = new Map<string, FolderNode>();
  for (const folder of known) {
    nodes.set(folder, { folder, label: folderName(folder), count: count.get(folder) ?? 0, own: own.get(folder) ?? 0, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const [folder, node] of nodes) {
    const parent = folder.includes(FOLDER_SEP) ? nodes.get(parentFolder(folder)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // By name, not by count: a folder is a place, and a place that moves about
  // as notes are added to it is not one you can learn where to look for.
  const order = (a: FolderNode, b: FolderNode): number => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  const sortDeep = (list: FolderNode[]): FolderNode[] => {
    list.sort(order);
    for (const node of list) sortDeep(node.children);
    return list;
  };
  return sortDeep(roots);
}
