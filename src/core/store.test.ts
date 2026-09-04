// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHistory } from './history';
import { pathsFor } from './paths';
import { createSettings } from './settings';
import { createStore, TRASH_AGE_MS } from './store';
import { titleOf } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * The stores against a real temporary folder: the rules the app relied on
 * without a test while they were bound to Electron.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-core-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({ id, body, createdAt: 1000, updatedAt: 2000, ...extra });

describe('store', () => {
  it('writes one file per note, named after the title, and reads them back', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Shopping\n\n- milk'), note('b', '', { title: 'Plan' })] });
    const names = (await fs.readdir(pathsFor(root).notes)).sort();
    expect(names).toEqual(['Plan.md', 'Shopping.md']);
    expect(store.fileNameOf('a')).toBe('Shopping.md');
    const again = createStore(root);
    const { notes } = await again.loadNotes();
    expect(notes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(notes.find((n) => n.id === 'b')?.title).toBe('Plan');
  });

  it('touches only the files whose text changed', async () => {
    const store = createStore(root);
    const a = note('a', 'one');
    const b = note('b', 'two');
    await store.saveNotes({ version: 1, notes: [a, b] });
    const before = await fs.stat(path.join(pathsFor(root).notes, 'two.md'));
    await new Promise((r) => setTimeout(r, 20));
    await store.saveNotes({ version: 1, notes: [{ ...a, body: 'one more', updatedAt: 3000 }, b] });
    const after = await fs.stat(path.join(pathsFor(root).notes, 'two.md'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('moves a note that leaves the list into the trash, and can put it back', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep'), note('b', 'Gone')] });
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep')] });
    expect(await fs.readdir(pathsFor(root).notes)).toEqual(['Keep.md']);
    const trash = await store.listTrash();
    expect(trash.map((t) => t.id)).toEqual(['b']);
    expect(store.trashedIds().has('b')).toBe(true);
    const back = await store.restoreFromTrash('b');
    expect(back?.body).toBe('Gone');
    expect((await fs.readdir(pathsFor(root).notes)).sort()).toEqual(['Gone.md', 'Keep.md']);
    expect(await store.listTrash()).toEqual([]);
  });

  it('expires what has waited longer than the trash age', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Old')] });
    await store.saveNotes({ version: 1, notes: [] });
    expect(await store.expireTrash(Date.now() + TRASH_AGE_MS + 1000)).toEqual(['a']);
    expect(await store.listTrash()).toEqual([]);
  });

  it('reports its own writes and restores as changes', async () => {
    const store = createStore(root);
    const seen: string[] = [];
    store.onChange((c) => seen.push(...c.upserts.map((n) => `+${n.id}`), ...c.removed.map((id) => `-${id}`)));
    await store.saveNotes({ version: 1, notes: [note('a', 'A')] });
    await store.saveNotes({ version: 1, notes: [] });
    await store.restoreFromTrash('a');
    expect(seen).toEqual(['+a', '-a', '+a']);
  });

  it('renames the file when the title changes and keeps the id', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'First')] });
    await store.saveNotes({ version: 1, notes: [note('a', 'Second', { updatedAt: 3000 })] });
    expect(await fs.readdir(pathsFor(root).notes)).toEqual(['Second.md']);
    const text = await fs.readFile(path.join(pathsFor(root).notes, 'Second.md'), 'utf8');
    expect(text).toContain('id: a');
  });

  it('reads a file dropped in by hand and stamps it with an id', async () => {
    const dir = pathsFor(root).notes;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'Loose.md'), 'just text\n', 'utf8');
    const store = createStore(root);
    const { notes } = await store.loadNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Loose');
    expect(await fs.readFile(path.join(dir, 'Loose.md'), 'utf8')).toMatch(/^---\nid: /);
  });
});

describe('history', () => {
  it('keeps a first snapshot, refuses a second within the gap, and keeps on demand', async () => {
    const history = createHistory(root);
    const n = note('a', 'one');
    await history.record([n], new Set());
    expect(await history.listHistory('a')).toHaveLength(1);
    await history.record([{ ...n, body: 'two' }], new Set());
    expect(await history.listHistory('a')).toHaveLength(1);
    await history.keepNow({ ...n, body: 'two' });
    expect(await history.listHistory('a')).toHaveLength(2);
    const [newest] = await history.listHistory('a');
    expect((await history.getSnapshot('a', newest.at))?.body).toBe('two');
  });

  it('sweeps the history of notes that are neither live nor trashed, only when asked', async () => {
    const history = createHistory(root);
    await history.keepNow(note('gone', 'x'));
    await history.keepNow(note('trashed', 'y'));
    const fresh = createHistory(root);
    await fresh.record([note('live', 'z')], new Set(['trashed']), { sweep: false });
    expect(await fresh.listHistory('gone')).toHaveLength(1);
    const sweeping = createHistory(root);
    await sweeping.record([note('live', 'z')], new Set(['trashed']));
    expect(await sweeping.listHistory('gone')).toHaveLength(0);
    expect(await sweeping.listHistory('trashed')).toHaveLength(1);
    expect(await sweeping.listHistory('live')).toHaveLength(1);
  });
});

describe('settings', () => {
  it('round-trips through settings.json and falls back to defaults', async () => {
    const s = createSettings(root);
    expect((await s.loadSettings()).hotkey).toBe('ctrl+alt+n');
    await s.saveSettings({ closeToTray: true, hotkey: null, captureHotkey: 'ctrl+alt+j', reminders: true, views: [{ name: 'Due', query: 'due:week todo:' }], notesFolder: null });
    const again = createSettings(root);
    expect(await again.loadSettings()).toEqual({
      closeToTray: true,
      hotkey: null,
      captureHotkey: 'ctrl+alt+j',
      reminders: true,
      views: [{ name: 'Due', query: 'due:week todo:' }],
      notesFolder: null,
    });
  });
});

describe('store, re-reading the folder', () => {
  it('keeps a note whose file is there but cannot be read, rather than taking it for deleted', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep'), note('b', 'Locked')] });
    const dir = pathsFor(root).notes;
    // A directory under the file's name reads as EISDIR: present, unreadable, the way a lock looks.
    await fs.rm(path.join(dir, 'Locked.md'));
    await fs.mkdir(path.join(dir, 'Locked.md'));
    const { notes } = await store.loadNotes();
    expect(notes.map((n) => n.id)).toEqual(['a']);
    expect(store.fileNameOf('b')).toBe('Locked.md');
    // Once the file is really gone, so is the entry.
    await fs.rmdir(path.join(dir, 'Locked.md'));
    await store.loadNotes();
    expect(store.fileNameOf('b')).toBeNull();
  });

  it('takes a folder that cannot be listed for an error, not for an empty one', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep')] });
    // A file where the trash folder should be lists as ENOTDIR: not there is fine, not listable is not.
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(store.trashDir, 'not a folder', 'utf8');
    await expect(store.listTrash()).rejects.toThrow();
  });

  it('keeps the id of a file whose front matter was dropped by another editor', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep'), note('b', 'Plan', { title: 'Plan' })] });
    const dir = pathsFor(root).notes;
    await fs.writeFile(path.join(dir, 'Plan.md'), 'Plan, rewritten\n', 'utf8');
    const { notes } = await store.loadNotes();
    const plan = notes.find((n) => n.id === 'b');
    expect(plan?.body).toBe('Plan, rewritten');
    expect(plan?.createdAt).toBe(1000);
    expect(store.fileNameOf('b')).toBe('Plan.md');
    expect(await fs.readFile(path.join(dir, 'Plan.md'), 'utf8')).toMatch(/^---\nid: b\n/);
    expect(await fs.readdir(dir)).toEqual(['Keep.md', 'Plan.md']);
  });

  it('does not trash a note found from outside that a save made earlier has not heard of', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep')] });
    const dir = pathsFor(root).notes;
    let seq = 0;
    store.onChange((changes) => {
      seq = changes.seq;
    });
    await fs.writeFile(path.join(dir, 'New.md'), '---\nid: n\n---\nDropped in\n', 'utf8');
    await store.refresh();
    expect(seq).toBeGreaterThan(0);
    // A list made before that change: the new note is missing because it is unknown, not deleted.
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep')], seen: seq - 1 });
    expect(store.fileNameOf('n')).toBe('New.md');
    // A list made after it, still without the note, means what it says.
    await store.saveNotes({ version: 1, notes: [note('a', 'Keep')], seen: seq });
    expect(store.fileNameOf('n')).toBeNull();
    expect((await store.listTrash()).map((t) => t.id)).toEqual(['n']);
  });

  it('on a first read, keeps the id with the file named for its title, not the copy that sorts first', async () => {
    const dir = pathsFor(root).notes;
    await fs.mkdir(dir, { recursive: true });
    const text = '---\nid: p\ntitle: "Plan"\n---\nPlan\n';
    await fs.writeFile(path.join(dir, 'Plan.md'), text, 'utf8');
    await fs.writeFile(path.join(dir, 'Plan (conflicted copy).md'), text.replace('Plan\n', 'Plan, elsewhere\n'), 'utf8');
    const store = createStore(root);
    await store.loadNotes();
    expect(store.fileNameOf('p')).toBe('Plan.md');
  });

  it('gives a sync tool’s copy of a note the new id, not the note itself, whichever sorts first', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('p', 'Plan', { title: 'Plan' })] });
    const dir = pathsFor(root).notes;
    const text = await fs.readFile(path.join(dir, 'Plan.md'), 'utf8');
    // "Plan (conflicted copy).md" sorts before "Plan.md".
    await fs.writeFile(path.join(dir, 'Plan (conflicted copy).md'), text.replace('Plan\n', 'Plan, elsewhere\n'), 'utf8');
    const { notes } = await store.loadNotes();
    expect(store.fileNameOf('p')).toBe('Plan.md');
    const copy = notes.find((n) => n.id !== 'p');
    expect(copy?.body).toBe('Plan, elsewhere');
    expect(store.fileNameOf(copy?.id ?? '')).toBe('Plan (conflicted copy).md');
  });
});

describe('store, folders', () => {
  it('reads the notes in the folders inside the notes folder, and says where each is', async () => {
    const store = createStore(root);
    const dir = pathsFor(root).notes;
    await fs.mkdir(path.join(dir, 'Work', 'Clients'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Loose.md'), 'at the root', 'utf8');
    await fs.writeFile(path.join(dir, 'Work', 'Clients', 'Hale.md'), 'the client', 'utf8');
    const { notes, folders } = await store.loadNotes();
    const where = Object.fromEntries(notes.map((n) => [titleOf(n), n.folder]));
    expect(where).toEqual({ Loose: '', Hale: 'Work/Clients' });
    expect(folders).toEqual(['Work', 'Work/Clients']);
    expect(store.fileNameOf(notes.find((n) => titleOf(n) === 'Hale')!.id)).toBe('Work/Clients/Hale.md');
  });

  it('leaves the dot folders and the attachments folder out of the notebook entirely', async () => {
    const store = createStore(root);
    const paths = pathsFor(root);
    await fs.mkdir(path.join(paths.notes, '.obsidian'), { recursive: true });
    await fs.mkdir(paths.attachments, { recursive: true });
    await fs.mkdir(path.join(paths.notes, 'Work', 'attachments'), { recursive: true });
    await fs.writeFile(path.join(paths.notes, '.obsidian', 'Config.md'), 'not a note', 'utf8');
    await fs.writeFile(path.join(paths.attachments, 'Caption.md'), 'not a note', 'utf8');
    await fs.writeFile(path.join(paths.notes, 'Work', 'attachments', 'Deep.md'), 'a real note', 'utf8');
    const { notes, folders } = await store.loadNotes();
    expect(notes.map((n) => titleOf(n))).toEqual(['Deep']);
    // The reserved one is only the one at the top; a folder someone named
    // "attachments" further down is an ordinary folder.
    expect(folders).toEqual(['Work', 'Work/attachments']);
  });

  it('names two notes the same in two folders, and only numbers a name taken in the same one', async () => {
    const store = createStore(root);
    await store.createFolder('Work');
    await store.createFolder('Home');
    await store.saveNotes({
      version: 1,
      notes: [note('a', 'Plan', { folder: 'Work' }), note('b', 'Plan', { folder: 'Home' }), note('c', 'Plan', { folder: 'Work' })],
    });
    expect(store.fileNameOf('a')).toBe('Work/Plan.md');
    expect(store.fileNameOf('b')).toBe('Home/Plan.md');
    expect(store.fileNameOf('c')).toBe('Work/Plan 2.md');
  });

  it('moves a note without renaming it, and keeps its id', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Plan')] });
    await store.createFolder('Work/Clients');
    expect(await store.moveNote('a', 'Work/Clients')).toBe('Work/Clients/Plan.md');
    const { notes } = await store.loadNotes();
    expect(notes.map((n) => [n.id, titleOf(n), n.folder])).toEqual([['a', 'Plan', 'Work/Clients']]);
    // Nothing about where it is was written into the file.
    const text = await fs.readFile(path.join(pathsFor(root).notes, 'Work', 'Clients', 'Plan.md'), 'utf8');
    expect(text).not.toContain('folder');
  });

  it('refuses to file a note in a folder that is not there', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('a', 'Plan')] });
    await expect(store.moveNote('a', 'Nowhere')).rejects.toThrow(/no folder called/i);
  });

  it('renames and moves a whole folder, and every note in it keeps its id', async () => {
    const store = createStore(root);
    await store.createFolder('Work/Clients');
    await store.saveNotes({ version: 1, notes: [note('a', 'Hale', { folder: 'Work/Clients' })] });
    expect(await store.renameFolder('Work/Clients', 'Customers')).toBe('Work/Customers');
    expect(store.fileNameOf('a')).toBe('Work/Customers/Hale.md');
    await store.createFolder('Archive');
    expect(await store.moveFolder('Work/Customers', 'Archive')).toBe('Archive/Customers');
    const { notes } = await store.loadNotes();
    expect(notes.map((n) => [n.id, n.folder])).toEqual([['a', 'Archive/Customers']]);
  });

  it('will not put a folder inside itself, or take one that still holds something', async () => {
    const store = createStore(root);
    await store.createFolder('Work/Clients');
    await expect(store.moveFolder('Work', 'Work/Clients')).rejects.toThrow(/inside itself/i);
    await expect(store.deleteFolder('Work')).rejects.toThrow(/still has something in it/i);
    await store.deleteFolder('Work/Clients');
    expect(await store.listFolders()).toEqual(['Work']);
  });

  it('never makes two folders that differ only in case, because Windows cannot hold them', async () => {
    const store = createStore(root);
    expect(await store.createFolder('Work')).toBe('Work');
    expect(await store.createFolder('WORK')).toBe('Work');
    expect(await store.listFolders()).toEqual(['Work']);
  });

  it('puts a deleted note back in the folder it was deleted from', async () => {
    const store = createStore(root);
    await store.createFolder('Work');
    await store.saveNotes({ version: 1, notes: [note('a', 'Hale', { folder: 'Work' })] });
    await store.saveNotes({ version: 1, notes: [] });
    // The trash keeps the shape of the notebook, so nothing has to remember it.
    expect(await fs.readFile(path.join(pathsFor(root).trash, 'Work', 'Hale.md'), 'utf8')).toContain('Hale');
    const back = await store.restoreFromTrash('a');
    expect(back?.folder).toBe('Work');
    expect(store.fileNameOf('a')).toBe('Work/Hale.md');
  });
});

describe('store, a note that goes missing', () => {
  it('survives a move seen as two halves: gone from one scan, back in the next', async () => {
    // Codex's own acceptance test for the release. OneDrive takes the file
    // away and puts it back, and the two need not land in the same scan.
    const store = createStore(root);
    const dir = pathsFor(root).notes;
    await store.saveNotes({ version: 1, notes: [note('abc', 'Plan')] });
    const text = await fs.readFile(path.join(dir, 'Plan.md'), 'utf8');

    await fs.rm(path.join(dir, 'Plan.md'));
    await store.refresh();
    // Not trashed: only the app deleting a note puts it in the trash.
    expect(await store.listTrash()).toEqual([]);
    expect([...store.missingIds()]).toEqual(['abc']);
    // Its history is still spoken for, so the sweep cannot take it.
    expect([...store.keptIds()]).toContain('abc');

    // A new store, as a restart makes: what is missing was written down.
    const later = createStore(root);
    await fs.mkdir(path.join(dir, 'Work'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Work', 'Plan.md'), text, 'utf8');
    const { notes } = await later.loadNotes();
    expect(notes.map((n) => [n.id, n.folder])).toEqual([['abc', 'Work']]);
    expect([...later.missingIds()]).toEqual([]);
    expect(await later.listTrash()).toEqual([]);
  });

  it('forgets a note that never came back, once it has waited the month the trash gives', async () => {
    const store = createStore(root);
    await store.saveNotes({ version: 1, notes: [note('abc', 'Plan')] });
    await fs.rm(path.join(pathsFor(root).notes, 'Plan.md'));
    await store.refresh();
    expect(await store.expireTrash(Date.now())).toEqual([]);
    expect(await store.expireTrash(Date.now() + TRASH_AGE_MS + 1000)).toEqual(['abc']);
    expect([...store.missingIds()]).toEqual([]);
  });

  it('takes a move seen whole for a move, with no missing note in between', async () => {
    const store = createStore(root);
    const dir = pathsFor(root).notes;
    await store.saveNotes({ version: 1, notes: [note('abc', 'Plan')] });
    await fs.mkdir(path.join(dir, 'Work'), { recursive: true });
    await fs.rename(path.join(dir, 'Plan.md'), path.join(dir, 'Work', 'Plan.md'));
    await store.refresh();
    expect([...store.missingIds()]).toEqual([]);
    expect(store.fileNameOf('abc')).toBe('Work/Plan.md');
  });

  it('still calls the second of two files carrying one id a copy', async () => {
    const store = createStore(root);
    const dir = pathsFor(root).notes;
    await store.saveNotes({ version: 1, notes: [note('abc', 'Plan')] });
    const text = await fs.readFile(path.join(dir, 'Plan.md'), 'utf8');
    await fs.mkdir(path.join(dir, 'Work'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Work', 'Plan.md'), text, 'utf8');
    const { notes } = await store.loadNotes();
    expect(notes).toHaveLength(2);
    // The one already known keeps the id; the newcomer is stamped with another.
    expect(notes.filter((n) => n.id === 'abc').map((n) => n.folder)).toEqual(['']);
    expect(notes.every((n) => n.id)).toBe(true);
  });
});
