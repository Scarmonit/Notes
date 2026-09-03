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
    await s.saveSettings({ closeToTray: true, hotkey: null, captureHotkey: 'ctrl+alt+j' });
    const again = createSettings(root);
    expect(await again.loadSettings()).toEqual({ closeToTray: true, hotkey: null, captureHotkey: 'ctrl+alt+j' });
  });
});
