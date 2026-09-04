// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHistory } from './history';
import { pathsFor } from './paths';
import { createSettings } from './settings';
import { createStore, TRASH_AGE_MS } from './store';
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
    await s.saveSettings({ closeToTray: true, hotkey: null, captureHotkey: 'ctrl+alt+j', reminders: true, views: [{ name: 'Due', query: 'due:week todo:' }] });
    const again = createSettings(root);
    expect(await again.loadSettings()).toEqual({
      closeToTray: true,
      hotkey: null,
      captureHotkey: 'ctrl+alt+j',
      reminders: true,
      views: [{ name: 'Due', query: 'due:week todo:' }],
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
