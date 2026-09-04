// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathsFor } from './paths';
import { createStore } from './store';

/**
 * Writing a property through the store, against a real folder: the part of
 * the design that can actually damage a notebook, since it rewrites a file
 * somebody else may have written.
 */

let root: string;
let notesDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-props-'));
  notesDir = pathsFor(root).notes;
  await fs.mkdir(notesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A file as Obsidian might have left it: comments, complex YAML, duplicates. */
const OBSIDIAN = [
  '---',
  'id: abc',
  '# what this note is for',
  'status: draft',
  'tags: [work, urgent]',
  'config:',
  '  nested: true',
  '  deeper: 2',
  'status: also-draft',
  'created: 1970-01-01T00:00:01.000Z',
  'updated: 1970-01-01T00:00:02.000Z',
  '---',
  '# Plan',
  '',
  'Words. ^k3n9dq',
  '',
].join('\n');

const read = (): Promise<string> => fs.readFile(path.join(notesDir, 'Plan.md'), 'utf8');

async function seeded() {
  await fs.writeFile(path.join(notesDir, 'Plan.md'), OBSIDIAN);
  const store = createStore(root);
  await store.loadNotes();
  return store;
}

describe('setProperty', () => {
  it('reads the properties off a file written by something else', async () => {
    const store = createStore(root);
    await fs.writeFile(path.join(notesDir, 'Plan.md'), OBSIDIAN);
    const { notes } = await store.loadNotes();
    expect(notes[0].properties).toEqual([
      { key: 'status', value: 'draft', occurrence: 1, complex: false },
      { key: 'tags', value: ['work', 'urgent'], occurrence: 1, complex: false },
      { key: 'config', value: null, occurrence: 1, complex: true },
      { key: 'status', value: 'also-draft', occurrence: 2, complex: false },
    ]);
  });

  it('changes one property and leaves every other byte of the front matter alone', async () => {
    const store = await seeded();
    await store.setProperty('abc', { key: 'status', value: 'final', occurrence: 1 });
    const text = await read();
    expect(text).toContain('\nstatus: final\n');
    expect(text).toContain('\n# what this note is for\n');
    expect(text).toContain('\nconfig:\n  nested: true\n  deeper: 2\n');
    expect(text).toContain('\nstatus: also-draft\n');
    expect(text).toContain('\ntags: [work, urgent]\n');
    // And the body, marker and all, is exactly what it was.
    expect(text.endsWith('# Plan\n\nWords. ^k3n9dq\n')).toBe(true);
  });

  it('adds a key after the last property, before nothing else', async () => {
    const store = await seeded();
    const props = await store.setProperty('abc', { key: 'rating', value: 4 });
    expect(props.map((p) => p.key)).toEqual(['status', 'tags', 'config', 'status', 'rating']);
    // After the last property there is, which is not the same as at the end:
    // the note's own dates keep the place they stood in.
    expect(await read()).toContain('\nstatus: also-draft\nrating: 4\ncreated: ');
  });

  it('refuses a duplicated key that does not say which one it means', async () => {
    const store = await seeded();
    await expect(store.setProperty('abc', { key: 'status', value: 'x' })).rejects.toThrow(/written 2 times/);
    // Saying which is enough, and so is saying all of them.
    await store.setProperty('abc', { key: 'status', value: 'x', occurrence: 2 });
    expect(await read()).toContain('\nstatus: x\n');
    await store.setProperty('abc', { key: 'status', all: true });
    expect(await read()).not.toContain('status:');
  });

  it('quotes a value that would read back as something else, and never asks', async () => {
    const store = await seeded();
    await store.setProperty('abc', { key: 'tags', value: ['true', '42', 'plain'] });
    expect(await read()).toContain('\ntags: ["true", "42", plain]\n');
  });

  it('will not write the note’s own fields as YAML', async () => {
    const store = await seeded();
    for (const key of ['id', 'title', 'created', 'updated', 'pinned', 'aliases']) {
      await expect(store.setProperty('abc', { key, value: 'x' }), key).rejects.toThrow(/own fields/);
    }
  });

  it('refuses to make a key that is not a name a property can have', async () => {
    const store = await seeded();
    await expect(store.setProperty('abc', { key: 'not a key', value: 'x' })).rejects.toThrow(/not a name/);
  });

  it('reports the change so the window catches up without re-reading the folder', async () => {
    const store = await seeded();
    const seen: string[][] = [];
    store.onChange((c) => seen.push(c.upserts.map((n) => (n.properties ?? []).map((p) => `${p.key}=${String(p.value)}`).join(','))));
    await store.setProperty('abc', { key: 'status', value: 'final', occurrence: 1 });
    expect(seen[0][0]).toContain('status=final');
  });

  it('leaves an untouched note byte for byte identical through a load and a save', async () => {
    await fs.writeFile(path.join(notesDir, 'Plan.md'), OBSIDIAN);
    const store = createStore(root);
    const file = await store.loadNotes();
    await store.saveNotes(file);
    expect(await read()).toBe(OBSIDIAN);
  });
});
