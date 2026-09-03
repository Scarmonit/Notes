/**
 * Version history: a ring of whole-note snapshots, one file per note.
 *
 * The rules live here, away from the filesystem, so they can be reasoned
 * about and tested on their own. A snapshot is the note exactly as it stood
 * at a moment; restoring one is a plain assignment, never a patch, so a
 * history file that has drifted or been truncated can still only ever put
 * back text that was really written.
 */

export interface Snapshot {
  /** When the note looked like this. */
  at: number;
  /** The explicit title, when the note had one. */
  title?: string;
  body: string;
}

/** What the history sheet lists: enough to choose by, without the whole body. */
export interface SnapshotSummary {
  at: number;
  title?: string;
  chars: number;
  /** The first words, collapsed onto one line. */
  preview: string;
}

export interface HistoryFile {
  version: 1;
  snapshots: Snapshot[];
}

/** Never two snapshots closer together than this, so typing cannot fill the ring. */
export const MIN_GAP_MS = 5 * 60 * 1000;
/** How far back the ring reaches. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A ceiling whatever the ages, so one busy week cannot grow without limit. */
export const MAX_SNAPSHOTS = 60;

export const EMPTY_HISTORY: HistoryFile = { version: 1, snapshots: [] };

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s.at === 'number' && Number.isFinite(s.at) && typeof s.body === 'string';
}

/**
 * Parses one history file. Anything unreadable becomes an empty history: a
 * damaged record of the past must never stand in the way of the note itself.
 */
export function parseHistoryFile(text: string): HistoryFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_HISTORY;
  }
  if (!raw || typeof raw !== 'object') return EMPTY_HISTORY;
  const doc = raw as Record<string, unknown>;
  if (doc.version !== 1 || !Array.isArray(doc.snapshots)) return EMPTY_HISTORY;
  const snapshots: Snapshot[] = [];
  for (const entry of doc.snapshots) {
    if (!isSnapshot(entry)) continue;
    const snap: Snapshot = { at: entry.at, body: entry.body };
    if (typeof entry.title === 'string' && entry.title.trim()) snap.title = entry.title.trim();
    snapshots.push(snap);
  }
  snapshots.sort((a, b) => a.at - b.at);
  return { version: 1, snapshots };
}

const sameText = (a: Snapshot | null, note: { body: string; title?: string }): boolean =>
  a !== null && a.body === note.body && (a.title ?? '') === (note.title?.trim() ?? '');

/**
 * Whether the note as it now stands is worth keeping.
 *
 * A note the history has never seen is kept at once, so every note has a
 * restore point from its first save. After that, unchanged text is never kept
 * twice, and a change is only kept once the gap has passed — which means the
 * worst a restore can cost is the few minutes since the last snapshot.
 */
export function shouldSnapshot(last: Snapshot | null, note: { body: string; title?: string }, now: number): boolean {
  if (last === null) return true;
  if (sameText(last, note)) return false;
  return now - last.at >= MIN_GAP_MS;
}

/** A snapshot of a note as it stands. */
export function snapshotOf(note: { body: string; title?: string }, at: number): Snapshot {
  const title = note.title?.trim();
  return title ? { at, title, body: note.body } : { at, body: note.body };
}

/**
 * Drops what has aged out, newest last. The most recent snapshot always
 * survives: a note left alone for a month should still have somewhere to go
 * back to, even though every snapshot of it is old.
 */
export function pruneSnapshots(snapshots: Snapshot[], now: number): Snapshot[] {
  const ordered = [...snapshots].sort((a, b) => a.at - b.at);
  const newest = ordered[ordered.length - 1];
  const kept = ordered.filter((s) => now - s.at <= MAX_AGE_MS || s === newest);
  return kept.slice(-MAX_SNAPSHOTS);
}

/** Appends a snapshot and prunes the ring. */
export function addSnapshot(snapshots: Snapshot[], snap: Snapshot): Snapshot[] {
  return pruneSnapshots([...snapshots, snap], snap.at);
}

/** One line of the snapshot's opening words, for the list in the sheet. */
export function previewOf(body: string, max = 90): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function summarize(snap: Snapshot): SnapshotSummary {
  const out: SnapshotSummary = { at: snap.at, chars: snap.body.length, preview: previewOf(snap.body) };
  if (snap.title) out.title = snap.title;
  return out;
}
