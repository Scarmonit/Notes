import type { Dirent } from 'node:fs';
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

/**
 * How many markdown files a folder holds, counting the folders inside it; 0
 * when it does not exist. Notes live in a tree now, so a notebook that looks
 * empty at the top may hold a hundred notes one folder down — and taking it
 * for empty is how two notebooks get merged into one.
 */
export async function countNotes(dir: string): Promise<number> {
  let found = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (!entry.name.startsWith('.')) found += await countNotes(path.join(dir, entry.name));
    } else if (entry.isFile() && isNoteFileName(entry.name)) found++;
  }
  return found;
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
 * Moves the files a folder holds into another, making it first, and the
 * folders inside it with them: a notebook is a tree, and half of it left
 * behind is not a notebook that moved.
 *
 * A missing source folder is nothing to do; a name already taken in the target
 * is left alone, because a file that is already there is not this one's to
 * replace. A folder whose name is taken is not skipped but walked into, so two
 * trees meeting at `Work` merge rather than one being abandoned.
 */
export async function moveInto(from: string, to: string, keep: (name: string) => boolean): Promise<number> {
  if (path.resolve(from) === path.resolve(to)) return 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile() && keep(e.name));
  if (dirs.length === 0 && files.length === 0) return 0;
  await fs.mkdir(to, { recursive: true });
  const taken = new Set(await fs.readdir(to).catch(() => []));
  let moved = 0;
  for (const file of files) {
    if (taken.has(file.name)) continue;
    await moveFile(path.join(from, file.name), path.join(to, file.name));
    moved++;
  }
  for (const dir of dirs) {
    moved += await moveInto(path.join(from, dir.name), path.join(to, dir.name), keep);
    // The folder itself goes too, once what was in it has: an empty one left
    // behind would read as a place someone made in the new notebook.
    await fs.rmdir(path.join(from, dir.name)).catch(() => undefined);
  }
  return moved;
}

/** Everything that is not a hidden file: what an attachments folder holds. */
export const notHidden = (name: string): boolean => !name.startsWith('.');
