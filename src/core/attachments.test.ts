// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttachments } from './attachments';
import type { NotesFile } from '../shared/types';

/**
 * The orphan sweep against a real folder. The grace period runs from the
 * moment a picture lost its last mention, never from when it was attached:
 * an old picture cut from one note and pasted into another, or a deleted
 * note brought back from the trash, must find it still there.
 */

let root: string;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
const file = (...bodies: string[]): NotesFile => ({ version: 1, notes: bodies.map((body, i) => ({ id: `n${i}`, body, createdAt: 1, updatedAt: 1 })) });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-att-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Makes the picture look attached an hour ago. */
async function age(dir: string, name: string): Promise<void> {
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await fs.utimes(path.join(dir, name), old, old);
}

describe('sweepOrphans', () => {
  it('keeps an old picture that only just lost its last mention', async () => {
    const att = createAttachments(root);
    const url = await att.saveAttachment(PNG, 'a.png');
    const name = url.slice('note-asset://'.length);
    await age(att.dir, name);
    // Mentioned: stays. Then unmentioned for the first time: still stays, the grace period has only begun.
    await att.sweepOrphans(file(`![a](${url})`));
    await att.sweepOrphans(file('nothing here'));
    expect(await fs.readdir(att.dir)).toEqual([name]);
  });

  it('keeps a picture a note in the trash still mentions', async () => {
    const att = createAttachments(root);
    const url = await att.saveAttachment(PNG, 'a.png');
    const name = url.slice('note-asset://'.length);
    await age(att.dir, name);
    // A sweep that saw it unmentioned long ago: only the trash keeps it now.
    const gone = Date.now() - 2 * 60 * 60 * 1000;
    const spy = { now: gone };
    const realNow = Date.now;
    Date.now = () => spy.now;
    try {
      await att.sweepOrphans(file('nothing'));
      spy.now = realNow();
      await att.sweepOrphans(file('nothing'), async () => [`![kept](${url})`]);
      expect(await fs.readdir(att.dir)).toEqual([name]);
      await att.sweepOrphans(file('nothing'), async () => []);
      expect(await fs.readdir(att.dir)).toEqual([]);
    } finally {
      Date.now = realNow;
    }
  });
});
