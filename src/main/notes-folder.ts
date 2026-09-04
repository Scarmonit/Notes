import { app, dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { forgetNotesFolder, pathsFor } from '../core/paths';
import { countNotes, moveInto, notHidden } from '../core/vault';
import { isNoteFileName } from '../shared/notes-folder';
import type { FolderChange } from '../shared/types';
import { settingsStore } from './settings';

/**
 * Choosing where the notes live.
 *
 * The folder is a setting, read by `pathsFor` before anything opens a file,
 * so the window and the `notes` command always agree about where the markdown
 * is. Changing it therefore means starting again with the new answer — which
 * the app does itself, once it has moved the files.
 *
 * Two things can be meant by choosing a folder, and the difference is in the
 * folder rather than in a question:
 *
 * - **An empty folder**: the notes are moved into it, pictures and all, and
 *   the old one is left behind with nothing in it.
 * - **A folder that already holds notes**: those are the notes from now on.
 *   Nothing is moved, nothing is merged, and the notes here stay where they
 *   are, so pointing Notes at a synced notebook is not a destructive act.
 */

const userData = (): string => app.getPath('userData');

/** The folder the notes are in now. */
export function currentNotesFolder(): string {
  return pathsFor(userData()).notes;
}

/**
 * Points Notes at a folder, moving the notes into it when it is empty. The
 * caller flushes first: whatever is on screen must be on disk before the
 * files move, or the words being typed would move to the old place.
 */
export async function useNotesFolder(target: string | null): Promise<FolderChange> {
  const settings = settingsStore.settings();
  const here = pathsFor(userData());
  const wanted = target === null ? null : path.resolve(target);
  if ((wanted ?? '') === (settings.notesFolder ?? '')) {
    return { ok: true, folder: wanted, message: 'The notes are already there', restart: false };
  }
  const next = pathsFor(userData(), wanted);
  if (path.resolve(next.notes) === path.resolve(here.notes)) {
    return { ok: true, folder: wanted, message: 'The notes are already there', restart: false };
  }

  const already = await countNotes(next.notes);
  let message: string;
  if (already > 0) {
    message = `${already} ${already === 1 ? 'note' : 'notes'} found in that folder; Notes will use them from now on`;
  } else {
    await fs.mkdir(next.notes, { recursive: true });
    const notes = await moveInto(here.notes, next.notes, isNoteFileName);
    const pictures = await moveInto(here.attachments, next.attachments, notHidden);
    message =
      notes === 0
        ? 'The notes will be kept there from now on'
        : `${notes} ${notes === 1 ? 'note' : 'notes'}${pictures > 0 ? ` and ${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : ''} moved`;
  }

  await settingsStore.saveSettings({ ...settings, notesFolder: wanted });
  forgetNotesFolder(userData());
  return { ok: true, folder: wanted, message: `${message}. Notes will start again to read them.`, restart: true };
}

/** Asks for a folder, then uses it. Nothing chosen is nothing done. */
export async function pickNotesFolder(win: BrowserWindow): Promise<FolderChange | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Where should the notes live?',
    defaultPath: currentNotesFolder(),
    buttonLabel: 'Keep notes here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return null;
  return useNotesFolder(filePaths[0]);
}

/** Starts the app again so every store opens on the new folder. */
export function restartForFolder(): void {
  app.relaunch();
  app.exit(0);
}
