// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from './backend';
import { createFileBackend } from './file-backend';
import { EXIT } from './ipc-protocol';
import type { Note } from '../shared/types';

/** The command line's own backend, against a real temporary folder. */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-file-backend-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({ id, body, createdAt: 1000, updatedAt: 2000, ...extra });

describe('file backend, put', () => {
  it('refuses to replace a note that changed since it was read, unless forced', async () => {
    const backend = createFileBackend(root, { version: '0.0.0' });
    await backend.put(note('a', 'first'));
    const changed = note('a', 'typed meanwhile', { updatedAt: 3000 });
    await backend.put(changed);
    // A command that read the note at 2000 and now writes from that reading.
    const stale = note('a', 'from the editor', { updatedAt: 4000 });
    await expect(backend.put(stale, { expectUpdatedAt: 2000 })).rejects.toMatchObject({ exit: EXIT.busy });
    expect((await backend.get('a'))?.body).toBe('typed meanwhile');
    // Read at 3000: fine. Forced: fine either way.
    await backend.put(stale, { expectUpdatedAt: 3000 });
    expect((await backend.get('a'))?.body).toBe('from the editor');
    await backend.put(note('a', 'forced', { updatedAt: 5000 }), { expectUpdatedAt: 1, force: true });
    expect((await backend.get('a'))?.body).toBe('forced');
    expect(new CliError('x', EXIT.busy).exit).toBe(EXIT.busy);
  });
});
