import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { parseWhen } from '../../core/query';
import { titleOf } from '../../renderer/notes';
import type { SnapshotSummary } from '../../shared/history';
import { describe, type Ctx } from '../context';
import { iso, relative } from '../output';

/** Version history: the snapshots kept as a note was written. */

/**
 * Which kept version `--at` means: a number counts from the newest (1 is
 * the latest), anything else is a moment, matched to the version nearest
 * before or at it.
 */
export function pickVersion(versions: SnapshotSummary[], at: string): SnapshotSummary | null {
  if (versions.length === 0) return null;
  if (/^\d{1,3}$/.test(at.trim())) return versions[Number(at) - 1] ?? null;
  const exact = versions.find((v) => String(v.at) === at.trim());
  if (exact) return exact;
  const t = parseWhen(at);
  if (t === null) return null;
  // Newest first: the first one at or before the moment is the nearest.
  return versions.find((v) => v.at <= t) ?? versions[versions.length - 1];
}

/** A plain line-by-line diff: enough to see what changed, without a library. */
export function diffLines(a: string, b: string): string[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push(`  ${x[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < n) out.push(`- ${x[i++]}`);
  while (j < m) out.push(`+ ${y[j++]}`);
  return out;
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;
  const history = program.command('history').description('the versions of a note kept as it was written');

  history
    .command('list', { isDefault: true })
    .alias('ls')
    .description('every kept version, newest first')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .action(async (selector: string) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const versions = await backend.historyList(note.id);
      const rows = versions.map((v, i) => ({ n: i + 1, at: v.at, when: iso(v.at), title: v.title ?? null, chars: v.chars, preview: v.preview }));
      c.out.rows(rows, [
        { key: 'n', label: '#', align: 'right', style: 'dim' },
        { key: 'at', label: 'when', format: (v) => relative(Number(v)) },
        { key: 'chars', label: 'chars', align: 'right', style: 'dim' },
        { key: 'preview', label: '', shrink: true, style: 'dim' },
      ]);
    });

  history
    .command('show')
    .description('print one kept version')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .requiredOption('--at <version>', '1 for the newest, 2 for the one before…, or a moment (ISO, 2h, yesterday)')
    .action(async (selector: string, opts: { at: string }) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const version = pickVersion(await backend.historyList(note.id), opts.at);
      if (!version) throw new CliError(`No kept version of "${titleOf(note)}" matches ${opts.at}`, EXIT.notFound);
      const snap = await backend.historyGet(note.id, version.at);
      if (!snap) throw new CliError('That version could not be read', EXIT.failure);
      c.out.value({ id: note.id, at: snap.at, when: iso(snap.at), title: snap.title ?? null, body: snap.body }, () =>
        c.out.mode === 'plain' ? snap.body : `${c.out.bold(snap.title ?? titleOf(note))}\n${c.out.dim(`version from ${iso(snap.at)}`)}\n\n${snap.body}`,
      );
    });

  history
    .command('restore')
    .description('put a kept version back (the current text is kept first)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .requiredOption('--at <version>', '1 for the newest, 2 for the one before…, or a moment')
    .option('--force', 'restore even while the note is being typed in the window')
    .action(async (selector: string, opts: { at: string; force?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const version = pickVersion(await backend.historyList(note.id), opts.at);
      if (!version) throw new CliError(`No kept version of "${titleOf(note)}" matches ${opts.at}`, EXIT.notFound);
      const restored = await backend.historyRestore(note.id, version.at, { force: opts.force });
      c.out.value(describe(restored), () => `Restored "${titleOf(restored)}" from ${relative(version.at)}`);
    });

  history
    .command('keep')
    .description('keep the note as it stands now, whatever the usual gap would say')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .action(async (selector: string) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      await backend.historyKeep(note.id);
      c.out.value({ id: note.id, kept: true }, () => `Kept "${titleOf(note)}"`);
    });

  history
    .command('diff')
    .description('what changed between two versions (or a version and now)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--from <version>', 'the older version (default: the newest kept)', '1')
    .option('--to <version>', 'the newer version (default: the note as it is now)')
    .action(async (selector: string, opts: { from: string; to?: string }) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const versions = await backend.historyList(note.id);
      const from = pickVersion(versions, opts.from);
      if (!from) throw new CliError(`No kept version matches ${opts.from}`, EXIT.notFound);
      const older = await backend.historyGet(note.id, from.at);
      let newer = { at: note.updatedAt, body: note.body };
      if (opts.to) {
        const to = pickVersion(versions, opts.to);
        const snap = to && (await backend.historyGet(note.id, to.at));
        if (!snap) throw new CliError(`No kept version matches ${opts.to}`, EXIT.notFound);
        newer = snap;
      }
      if (!older) throw new CliError('That version could not be read', EXIT.failure);
      const lines = diffLines(older.body, newer.body);
      c.out.value({ id: note.id, from: iso(older.at), to: opts.to ? iso(newer.at) : 'now', diff: lines }, () =>
        [
          c.out.dim(`--- ${iso(older.at)}`),
          c.out.dim(`+++ ${opts.to ? iso(newer.at) : 'now'}`),
          ...lines.map((l) => (l.startsWith('- ') ? c.out.color('red', l) : l.startsWith('+ ') ? c.out.color('green', l) : c.out.dim(l))),
        ].join('\n'),
      );
    });
}
