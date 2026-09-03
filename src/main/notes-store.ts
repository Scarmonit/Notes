import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EMPTY_FILE, parseNotesFile } from '../shared/notes-file';
import type { NotesFile } from '../shared/types';

export function notesPath(): string {
  return path.join(app.getPath('userData'), 'notes.json');
}

/**
 * Reads notes.json. A missing file is a fresh install. An unreadable one is
 * set aside under a .corrupt-<timestamp> name so nothing is silently lost,
 * and the app starts empty.
 */
export async function loadNotes(): Promise<NotesFile> {
  const file = notesPath();
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_FILE;
    throw err;
  }
  try {
    return parseNotesFile(text);
  } catch (err) {
    console.error('[notes] notes.json is unreadable, starting empty:', err);
    await fs.copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
    return EMPTY_FILE;
  }
}

// Writes are chained so two quick saves can never interleave their tmp files.
let chain: Promise<void> = Promise.resolve();

/** Atomically replaces notes.json: write to a sibling tmp file, then rename. */
export function saveNotes(file: NotesFile): Promise<void> {
  const run = async () => {
    const target = notesPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    await fs.rename(tmp, target);
  };
  chain = chain.then(run, run);
  return chain;
}
