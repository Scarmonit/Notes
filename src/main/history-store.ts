import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EMPTY_HISTORY,
  addSnapshot,
  parseHistoryFile,
  shouldSnapshot,
  snapshotOf,
  summarize,
  type Snapshot,
  type SnapshotSummary,
} from '../shared/history';
import type { Note } from '../shared/types';

/**
 * Snapshots of every note, one file per note, kept well away from the notes
 * themselves: a history file that goes bad can be thrown out on its own, and
 * can never take the notes down with it.
 *
 * Saving is the moment a note is worth remembering, so this hangs off the
 * save path — but off to the side of it, after the write has landed, because
 * nothing here is allowed to make saving slower or less certain.
 */

export function historyDir(): string {
  return path.join(app.getPath('userData'), 'history');
}

/**
 * A note id is not a filename. Ids the app makes are UUIDs, but a note that
 * arrived from somewhere else could carry anything, so the id is encoded
 * rather than trusted — reversibly, so two notes cannot share a file.
 */
function fileFor(id: string): string {
  return path.join(historyDir(), `${encodeURIComponent(id).slice(0, 120)}.json`);
}

/**
 * The last snapshot of each note, so deciding whether to keep one costs
 * nothing on the save path. A note is read from disk the first time it comes
 * up and never again.
 */
const lastKnown = new Map<string, Snapshot | null>();

async function readFileFor(id: string): Promise<Snapshot[]> {
  try {
    return parseHistoryFile(await fs.readFile(fileFor(id), 'utf8')).snapshots;
  } catch {
    return EMPTY_HISTORY.snapshots;
  }
}

async function lastOf(id: string): Promise<Snapshot | null> {
  const cached = lastKnown.get(id);
  if (cached !== undefined) return cached;
  const snapshots = await readFileFor(id);
  const last = snapshots[snapshots.length - 1] ?? null;
  lastKnown.set(id, last);
  return last;
}

/** Atomically replaces one note's history file. */
async function write(id: string, snapshots: Snapshot[]): Promise<void> {
  const target = fileFor(id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: 1, snapshots }), 'utf8');
  await fs.rename(tmp, target);
}

async function append(note: Note, at: number): Promise<void> {
  const snap = snapshotOf(note, at);
  await write(note.id, addSnapshot(await readFileFor(note.id), snap));
  lastKnown.set(note.id, snap);
}

// One pass over the notes at a time: saves come every few hundred
// milliseconds while typing, and they must not pile up on each other — nor
// on a version kept by hand, which writes the same file through the same
// temporary name.
let recording: Promise<void> = Promise.resolve();
let swept = false;

function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = recording.then(run, run);
  recording = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Keeps the note as it stands right now, whatever the usual gap would say. */
export function keepNow(note: Note): Promise<void> {
  return serial(async () => {
    const last = await lastOf(note.id);
    if (last && last.body === note.body && (last.title ?? '') === (note.title?.trim() ?? '')) return;
    await append(note, Date.now());
  });
}

/**
 * Records anything worth recording from a just-saved file. Called after the
 * save, never before it, and its failures are logged rather than raised: a
 * note that saved but was not snapshotted is a small loss, a save that failed
 * because of the snapshot would be a large one.
 *
 * `alsoKeep` names notes that are not in the list but whose history must
 * stay — the ones waiting in the trash, which may yet come back.
 */
export function record(notes: Note[], alsoKeep: ReadonlySet<string>): Promise<void> {
  return serial(async () => {
    const now = Date.now();
    for (const note of notes) {
      if (shouldSnapshot(await lastOf(note.id), note, now)) await append(note, now);
    }
    // Once per launch is enough: notes are deleted by hand, not in floods.
    if (!swept) {
      swept = true;
      await sweepDeleted(notes, alsoKeep);
    }
  }).catch((err) => console.error('[notes] history failed', err));
}

/** Throws away the history of notes that are neither live nor in the trash. */
async function sweepDeleted(notes: Note[], alsoKeep: ReadonlySet<string>): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(historyDir());
  } catch {
    return;
  }
  const keep = new Set(notes.map((n) => path.basename(fileFor(n.id))));
  for (const id of alsoKeep) keep.add(path.basename(fileFor(id)));
  for (const name of names) {
    if (!name.endsWith('.json') || keep.has(name)) continue;
    await fs.unlink(path.join(historyDir(), name)).catch(() => undefined);
    lastKnown.delete(decodeURIComponent(name.slice(0, -'.json'.length)));
  }
}

/** Throws away one note's history: it has left the trash for good. */
export async function forgetHistory(id: string): Promise<void> {
  await fs.unlink(fileFor(id)).catch(() => undefined);
  lastKnown.delete(id);
}

/** Every kept version of one note, newest first, without the bodies. */
export async function listHistory(id: string): Promise<SnapshotSummary[]> {
  const snapshots = await readFileFor(id);
  return snapshots.map(summarize).reverse();
}

/** One kept version in full, by the moment it was taken. */
export async function getSnapshot(id: string, at: number): Promise<Snapshot | null> {
  const snapshots = await readFileFor(id);
  return snapshots.find((s) => s.at === at) ?? null;
}
