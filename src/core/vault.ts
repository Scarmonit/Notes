import fs from 'node:fs/promises';
import path from 'node:path';
import { isNoteFileName } from '../shared/notes-folder';

/**
 * Moving a notebook to another folder.
 *
 * Two callers do this — the window, which must stop writing first, and the
 * command line, which does it with the app closed — and they must do exactly
 * the same thing, so the doing of it is here and the deciding is theirs.
 */

/** How many markdown files a folder holds; 0 when it does not exist. */
export async function countNotes(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).filter(isNoteFileName).length;
  } catch {
    return 0;
  }
}

/** Moves a file, falling back to a copy when the two folders are on different drives. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

/**
 * Moves the files a folder holds into another, making it first. A missing
 * source folder is nothing to do; a name already taken in the target is left
 * alone, because a file that is already there is not this one's to replace.
 */
export async function moveInto(from: string, to: string, keep: (name: string) => boolean): Promise<number> {
  if (path.resolve(from) === path.resolve(to)) return 0;
  let names: string[];
  try {
    names = await fs.readdir(from);
  } catch {
    return 0;
  }
  const wanted = names.filter(keep);
  if (wanted.length === 0) return 0;
  await fs.mkdir(to, { recursive: true });
  const taken = new Set(await fs.readdir(to).catch(() => []));
  let moved = 0;
  for (const name of wanted) {
    if (taken.has(name)) continue;
    await moveFile(path.join(from, name), path.join(to, name));
    moved++;
  }
  return moved;
}

/** Everything that is not a hidden file: what an attachments folder holds. */
export const notHidden = (name: string): boolean => !name.startsWith('.');
