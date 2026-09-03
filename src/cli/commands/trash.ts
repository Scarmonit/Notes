import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { parseWhen } from '../../core/query';
import { TRASH_AGE_MS } from '../../core/store';
import { titleOf } from '../../renderer/notes';
import { describe, type Ctx } from '../context';
import { iso, relative, type Column } from '../output';

/** The trash: what was deleted, and putting it back or letting it go. */

const COLUMNS: Column[] = [
  { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
  { key: 'deletedAt', label: 'deleted', format: (v) => relative(Number(v)), style: 'dim' },
  { key: 'title', label: 'title', style: 'bold' },
  { key: 'preview', label: '', shrink: true, style: 'dim' },
];

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;
  const trash = program.command('trash').description('deleted notes, which wait a month before they are gone');

  trash
    .command('list', { isDefault: true })
    .alias('ls')
    .description('what is in the trash, most recently deleted first')
    .action(async () => {
      const c = ctx();
      const items = await (await c.backend()).trashList();
      const rows = items.map((t) => ({ ...t, deleted: iso(t.deletedAt), updated: iso(t.updatedAt), expires: iso(t.deletedAt + TRASH_AGE_MS) }));
      c.out.rows(rows, c.out.mode === 'pretty' ? COLUMNS : [{ key: 'id', label: 'id' }, { key: 'title', label: 'title' }, { key: 'deleted', label: 'deleted' }]);
    });

  trash
    .command('show')
    .description('print a deleted note')
    .argument('<note>', 'id, id prefix or title of a deleted note')
    .action(async (selector: string) => {
      const c = ctx();
      const backend = await c.backend();
      const item = await c.trashed(selector);
      const note = await backend.trashGet(item.id);
      if (!note) throw new CliError(`The deleted note ${item.id} could not be read`, EXIT.notFound);
      c.out.value({ ...describe(note), deletedAt: item.deletedAt, deleted: iso(item.deletedAt) }, () =>
        c.out.mode === 'plain' ? note.body : `${c.out.bold(titleOf(note))}\n${c.out.dim(`${note.id} · deleted ${relative(item.deletedAt)}`)}\n\n${note.body}`,
      );
    });

  trash
    .command('restore')
    .description('put a deleted note back, history and all')
    .argument('<note...>', 'ids, id prefixes or titles of deleted notes')
    .action(async (selectors: string[]) => {
      const c = ctx();
      const backend = await c.backend();
      const items = await backend.trashList();
      for (const selector of selectors) {
        const item = await c.trashed(selector, items);
        const note = await backend.trashRestore(item.id);
        if (!note) throw new CliError(`Could not put back ${item.id}`, EXIT.failure);
        c.out.value(describe(note), () => `Put back "${titleOf(note)}"`);
      }
    });

  trash
    .command('purge')
    .description('remove deleted notes for good')
    .argument('[note...]', 'ids, id prefixes or titles of deleted notes')
    .option('--older-than <span>', 'everything deleted longer ago than this: 30d, 2w…')
    .option('--all', 'empty the trash')
    .action(async (selectors: string[], opts: { olderThan?: string; all?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const items = await backend.trashList();
      let targets = items;
      if (selectors.length > 0) {
        targets = [];
        for (const s of selectors) targets.push(await c.trashed(s, items));
      } else if (opts.olderThan) {
        const cutoff = parseWhen(opts.olderThan);
        if (cutoff === null) throw new CliError(`--older-than wants a span like 30d; got "${opts.olderThan}"`, EXIT.usage);
        targets = items.filter((t) => t.deletedAt < cutoff);
      } else if (!opts.all) {
        throw new CliError('Say which: names, --older-than, or --all', EXIT.usage);
      }
      if (targets.length === 0) {
        c.out.message('Nothing to remove');
        return;
      }
      if (!(await c.confirm(`Remove ${targets.length === 1 ? `"${targets[0].title}"` : `${targets.length} deleted notes`} for good?`))) return;
      for (const t of targets) await backend.trashPurge(t.id);
      c.out.value(
        targets.map((t) => ({ id: t.id, title: t.title })),
        () => `Removed ${targets.length === 1 ? `"${targets[0].title}"` : `${targets.length} notes`} for good`,
      );
    });
}
