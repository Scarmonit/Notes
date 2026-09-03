import { describe, expect, it } from 'vitest';
import {
  MAX_AGE_MS,
  MAX_SNAPSHOTS,
  MIN_GAP_MS,
  addSnapshot,
  parseHistoryFile,
  previewOf,
  pruneSnapshots,
  shouldSnapshot,
  snapshotOf,
  summarize,
  type Snapshot,
} from './history';

const snap = (at: number, body = 'text'): Snapshot => ({ at, body });

describe('shouldSnapshot', () => {
  it('keeps a note the history has never seen', () => {
    expect(shouldSnapshot(null, { body: 'hello' }, 1000)).toBe(true);
  });

  it('never keeps the same text twice', () => {
    const last = { at: 0, body: 'hello' };
    expect(shouldSnapshot(last, { body: 'hello' }, MIN_GAP_MS * 10)).toBe(false);
  });

  it('waits out the gap before keeping a change', () => {
    const last = { at: 1000, body: 'hello' };
    expect(shouldSnapshot(last, { body: 'hello there' }, 1000 + MIN_GAP_MS - 1)).toBe(false);
    expect(shouldSnapshot(last, { body: 'hello there' }, 1000 + MIN_GAP_MS)).toBe(true);
  });

  it('counts a renamed note as changed', () => {
    const last = { at: 0, title: 'One', body: 'hello' };
    expect(shouldSnapshot(last, { title: 'Two', body: 'hello' }, MIN_GAP_MS)).toBe(true);
    expect(shouldSnapshot(last, { title: ' One ', body: 'hello' }, MIN_GAP_MS)).toBe(false);
  });
});

describe('snapshotOf', () => {
  it('carries the trimmed title, and leaves it out when there is none', () => {
    expect(snapshotOf({ body: 'b', title: '  Title ' }, 5)).toEqual({ at: 5, title: 'Title', body: 'b' });
    expect(snapshotOf({ body: 'b' }, 5)).toEqual({ at: 5, body: 'b' });
  });
});

describe('pruneSnapshots', () => {
  it('drops what has aged out', () => {
    const now = MAX_AGE_MS * 2;
    const kept = pruneSnapshots([snap(now - MAX_AGE_MS - 1), snap(now - 10)], now);
    expect(kept.map((s) => s.at)).toEqual([now - 10]);
  });

  it('always keeps the newest, however old it is', () => {
    const now = MAX_AGE_MS * 5;
    const kept = pruneSnapshots([snap(1), snap(2)], now);
    expect(kept.map((s) => s.at)).toEqual([2]);
  });

  it('caps the ring by count, oldest first', () => {
    const many = Array.from({ length: MAX_SNAPSHOTS + 10 }, (_, i) => snap(i + 1));
    const kept = pruneSnapshots(many, MAX_SNAPSHOTS + 10);
    expect(kept).toHaveLength(MAX_SNAPSHOTS);
    expect(kept[kept.length - 1].at).toBe(MAX_SNAPSHOTS + 10);
  });

  it('sorts oldest to newest', () => {
    expect(pruneSnapshots([snap(3), snap(1), snap(2)], 3).map((s) => s.at)).toEqual([1, 2, 3]);
  });
});

describe('addSnapshot', () => {
  it('appends and prunes in one step', () => {
    const now = MAX_AGE_MS * 2;
    const next = addSnapshot([snap(now - MAX_AGE_MS - 1), snap(now - 5)], snap(now, 'new'));
    expect(next.map((s) => s.at)).toEqual([now - 5, now]);
  });
});

describe('parseHistoryFile', () => {
  it('reads a well-formed file', () => {
    const text = JSON.stringify({ version: 1, snapshots: [{ at: 2, body: 'b', title: 'T' }] });
    expect(parseHistoryFile(text).snapshots).toEqual([{ at: 2, title: 'T', body: 'b' }]);
  });

  it('turns anything unreadable into an empty history', () => {
    expect(parseHistoryFile('not json').snapshots).toEqual([]);
    expect(parseHistoryFile('null').snapshots).toEqual([]);
    expect(parseHistoryFile('{"version":2,"snapshots":[]}').snapshots).toEqual([]);
  });

  it('drops malformed entries but keeps the rest', () => {
    const text = JSON.stringify({ version: 1, snapshots: [{ at: 'soon', body: 'b' }, { at: 3, body: 'ok' }, 7] });
    expect(parseHistoryFile(text).snapshots).toEqual([{ at: 3, body: 'ok' }]);
  });

  it('puts the snapshots back in order', () => {
    const text = JSON.stringify({ version: 1, snapshots: [{ at: 9, body: 'b' }, { at: 2, body: 'a' }] });
    expect(parseHistoryFile(text).snapshots.map((s) => s.at)).toEqual([2, 9]);
  });
});

describe('previewOf', () => {
  it('collapses whitespace onto one line', () => {
    expect(previewOf('# Title\n\nsome  words')).toBe('# Title some words');
  });

  it('truncates long text with an ellipsis', () => {
    expect(previewOf('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('summarize', () => {
  it('measures the body without carrying it', () => {
    const out = summarize({ at: 4, title: 'T', body: 'hello there' });
    expect(out).toEqual({ at: 4, title: 'T', chars: 11, preview: 'hello there' });
  });
});
