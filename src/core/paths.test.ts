// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanNotesFolder, forgetNotesFolder, notesFolderFor, pathsFor, SETTINGS_FILE } from './paths';
import { countNotes, moveInto, notHidden } from './vault';
import { isNoteFileName } from '../shared/notes-folder';

let root: string;
let elsewhere: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-paths-'));
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-vault-'));
  forgetNotesFolder();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
  forgetNotesFolder();
});

const writeSettings = (doc: unknown): void => fs.writeFileSync(path.join(root, SETTINGS_FILE), JSON.stringify(doc));

describe('pathsFor', () => {
  it('keeps everything beside the app when no folder is chosen', () => {
    const p = pathsFor(root);
    expect(p.notes).toBe(path.join(root, 'notes'));
    expect(p.attachments).toBe(path.join(root, 'attachments'));
  });

  it('puts the notes and their pictures in the chosen folder, and the rest where it was', () => {
    const p = pathsFor(root, elsewhere);
    expect(p.notes).toBe(elsewhere);
    // The pictures travel with the notes: a notebook in OneDrive that left its
    // images behind would be broken everywhere else.
    expect(p.attachments).toBe(path.join(elsewhere, 'attachments'));
    expect(p.trash).toBe(path.join(root, 'trash'));
    expect(p.history).toBe(path.join(root, 'history'));
    expect(p.settings).toBe(path.join(root, SETTINGS_FILE));
    expect(p.ipc).toBe(path.join(root, 'ipc.json'));
  });

  it('reads the folder off settings.json, so both sides find the same notes', () => {
    writeSettings({ notesFolder: elsewhere });
    expect(pathsFor(root).notes).toBe(elsewhere);
  });

  it('is the usual place when the settings say nothing, or nonsense', () => {
    writeSettings({ notesFolder: '   ' });
    expect(pathsFor(root).notes).toBe(path.join(root, 'notes'));
    forgetNotesFolder();
    writeSettings({ notesFolder: 7 });
    expect(pathsFor(root).notes).toBe(path.join(root, 'notes'));
    forgetNotesFolder();
    fs.writeFileSync(path.join(root, SETTINGS_FILE), 'not json');
    expect(pathsFor(root).notes).toBe(path.join(root, 'notes'));
  });

  it('reads the file once and again after it is told to', () => {
    expect(notesFolderFor(root)).toBeNull();
    writeSettings({ notesFolder: elsewhere });
    expect(notesFolderFor(root)).toBeNull();
    forgetNotesFolder(root);
    expect(notesFolderFor(root)).toBe(elsewhere);
  });
});

describe('cleanNotesFolder', () => {
  it('makes a folder absolute, and anything else nothing', () => {
    expect(cleanNotesFolder(elsewhere)).toBe(path.resolve(elsewhere));
    expect(cleanNotesFolder('')).toBeNull();
    expect(cleanNotesFolder(null)).toBeNull();
    expect(cleanNotesFolder(3)).toBeNull();
  });
});

describe('moving a notebook', () => {
  const seed = (dir: string, names: string[]): void => {
    fs.mkdirSync(dir, { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(dir, n), `# ${n}`);
  };

  it('moves the markdown and leaves nothing behind', async () => {
    const from = path.join(root, 'notes');
    seed(from, ['One.md', 'Two.md', 'notes.json.migrated']);
    expect(await moveInto(from, elsewhere, isNoteFileName)).toBe(2);
    expect(fs.readdirSync(elsewhere).sort()).toEqual(['One.md', 'Two.md']);
    // Only the notes move: what else is in the folder is the folder's own.
    expect(fs.readdirSync(from)).toEqual(['notes.json.migrated']);
  });

  it('counts what a folder already holds, and 0 when there is no folder', async () => {
    seed(elsewhere, ['A.md', 'B.md', 'thing.txt']);
    expect(await countNotes(elsewhere)).toBe(2);
    expect(await countNotes(path.join(root, 'nowhere'))).toBe(0);
  });

  it('leaves a name that is already taken alone', async () => {
    const from = path.join(root, 'notes');
    seed(from, ['One.md']);
    seed(elsewhere, ['One.md']);
    fs.writeFileSync(path.join(elsewhere, 'One.md'), 'theirs');
    expect(await moveInto(from, elsewhere, isNoteFileName)).toBe(0);
    expect(fs.readFileSync(path.join(elsewhere, 'One.md'), 'utf8')).toBe('theirs');
  });

  it('is nothing to do when the source is missing, or the two are the same', async () => {
    expect(await moveInto(path.join(root, 'nowhere'), elsewhere, isNoteFileName)).toBe(0);
    seed(elsewhere, ['A.md']);
    expect(await moveInto(elsewhere, elsewhere, isNoteFileName)).toBe(0);
  });

  it('moves the pictures too, hidden files apart', async () => {
    const from = path.join(root, 'attachments');
    seed(from, ['a1b2c3d4.png', '.keep']);
    expect(await moveInto(from, path.join(elsewhere, 'attachments'), notHidden)).toBe(1);
    expect(fs.readdirSync(path.join(elsewhere, 'attachments'))).toEqual(['a1b2c3d4.png']);
  });
});
