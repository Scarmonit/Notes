// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../shared/types';

/**
 * The reminder timer with Electron's Notification stood in for. A task due
 * earlier today in a note being typed must wait until the typing stops:
 * otherwise it fired the moment its date was complete, and again for every
 * keystroke of the words after it, since the words are in its key.
 */

const shown: Array<{ title: string; body: string }> = [];
vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return true;
    }
    constructor(private readonly options: { title: string; body: string }) {}
    on(): void {}
    show(): void {
      shown.push(this.options);
    }
  },
}));

const { createReminders, QUIET_MS } = await import('./reminders');

let root: string;
const noon = new Date(2026, 8, 3, 12, 0).getTime();
const note = (id: string, body: string, updatedAt: number): Note => ({ id, body, title: 'Plan', createdAt: 1, updatedAt });

/** Lets the file read behind the first update finish, then the timers run. */
async function settle(ms: number): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-rem-'));
  shown.length = 0;
  // Only the clock and setTimeout are faked: reading reminded.json is real I/O, which setImmediate lets finish.
  vi.useFakeTimers({ now: noon, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(root, { recursive: true, force: true });
});

describe('reminders', () => {
  it('shows a task that came due while the app was closed at once, but one being typed only after the typing stops', async () => {
    const reminders = createReminders({ userData: root, enabled: () => true, openNote: () => undefined });
    // Loaded from disk: last edited an hour ago, due at nine this morning.
    reminders.update([note('old', '- [ ] rent @2026-09-03', noon - 3600_000)]);
    await settle(10);
    expect(shown.map((s) => s.title)).toEqual(['rent']);

    // Being typed now: each save is a tick, none of them may fire.
    for (const words of ['- [ ] call @2026-09-03', '- [ ] call mom @2026-09-03', '- [ ] call mom now @2026-09-03']) {
      reminders.update([note('old', '- [ ] rent @2026-09-03', noon - 3600_000), note('typing', words, Date.now())]);
      await settle(300);
    }
    expect(shown).toHaveLength(1);
    await settle(QUIET_MS + 300);
    expect(shown.map((s) => s.title)).toEqual(['rent', 'call mom now']);
    reminders.stop();
  });
});
