import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { folderKey, folderLabel, folderMatches, parseFolder, ROOT_FOLDER, segmentProblem } from '../../shared/folders';
import { describe, type Ctx } from '../context';

/**
 * Folders on the command line: where a note lives, and the five things that
 * can be done to a place.
 *
 * `notes move` is a top-level verb because it is about a note, the way
 * `notes rename` and `notes pin` are; everything under `notes folders` is
 * about the folder itself, the way `notes history` and `notes settings` group
 * what they are about.
 */

/** The folder a path means, as it is spelt on disk, or a refusal that says why. */
async function existing(ctx: Ctx, typed: string): Promise<string> {
  if (typed === '/' || !typed.trim()) return ROOT_FOLDER;
  const parsed = parseFolder(typed);
  if ('error' in parsed) throw new CliError(parsed.error, EXIT.usage);
  const folders = await (await ctx.backend()).folderList();
  const found = folders.find((f) => folderKey(f) === folderKey(parsed.folder));
  if (!found) throw new CliError(`There is no folder called ${parsed.folder}`, EXIT.notFound);
  return found;
}

/** A folder that is not the root, for the commands that cannot act on it. */
async function realFolder(ctx: Ctx, typed: string, verb: string): Promise<string> {
  const folder = await existing(ctx, typed);
  if (!folder) throw new CliError(`The notebook itself cannot be ${verb}`, EXIT.usage);
  return folder;
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  program
    .command('move')
    .description('file a note in another folder, keeping its name, its links and its history')
    .argument('<note>', 'id, title, title prefix, filename, path, or - for stdin')
    .argument('<folder>', 'the folder to file it in, which must already exist; / is the root')
    .action(async (selector: string, folder: string) => {
      const c = ctx();
      const note = await c.note(selector);
      const target = await existing(c, folder);
      const path = await (await c.backend()).noteMove(note.id, target);
      c.out.value({ ...describe(note), folder: target, path }, () => `Filed in ${folderLabel(target)}: ${path}`);
    });

  // Plural: `notes folder` has meant the notebook's own location since 0.19.0,
  // and a script that says it must go on meaning that.
  const folders = program.command('folders').description('the folders notes are filed in: real directories inside the notes folder');

  folders
    .command('list', { isDefault: true })
    .alias('ls')
    .description('every folder, empty ones included, with how many notes are in each')
    .action(async () => {
      const c = ctx();
      const backend = await c.backend();
      const [all, notes] = await Promise.all([backend.folderList(), backend.notes()]);
      const rows = all.map((folder) => ({
        folder,
        // Both counts, because a folder that holds nothing but folders is not
        // empty and a folder full of notes may hold none of its own.
        notes: notes.filter((n) => (n.folder ?? ROOT_FOLDER) === folder).length,
        total: notes.filter((n) => folderMatches(n.folder ?? ROOT_FOLDER, folder)).length,
      }));
      c.out.rows(rows, [
        { key: 'folder', label: 'folder', style: 'bold' },
        { key: 'notes', label: 'notes', style: 'dim' },
        { key: 'total', label: 'with nested', style: 'dim' },
      ]);
    });

  folders
    .command('new')
    .alias('add')
    .description('make a folder, and every folder above it')
    .argument('<path>', 'a path from the notes folder, such as Work/Clients/Hale')
    .action(async (path: string) => {
      const c = ctx();
      const parsed = parseFolder(path);
      if ('error' in parsed) throw new CliError(parsed.error, EXIT.usage);
      if (!parsed.folder) throw new CliError('Give the folder a name', EXIT.usage);
      const made = await (await c.backend()).folderCreate(parsed.folder);
      c.out.value({ folder: made }, () => `Made ${folderLabel(made)}`);
    });

  folders
    .command('rename')
    .description("change a folder's own name, leaving it where it is")
    .argument('<folder>', 'the folder, as a path from the notes folder')
    .argument('<name>', 'its new name — one name, not a path')
    .action(async (folder: string, name: string) => {
      const c = ctx();
      const from = await realFolder(c, folder, 'renamed');
      const problem = segmentProblem(name.trim());
      if (problem) throw new CliError(problem, EXIT.usage);
      const now = await (await c.backend()).folderRename(from, name.trim());
      c.out.value({ folder: now, was: from }, () => `${folderLabel(from)} is now ${folderLabel(now)}`);
    });

  folders
    .command('move')
    .description('put a folder, and everything in it, inside another')
    .argument('<folder>', 'the folder to move')
    .argument('<destination>', 'the folder it goes inside; / is the root')
    .action(async (folder: string, destination: string) => {
      const c = ctx();
      const from = await realFolder(c, folder, 'moved');
      const into = await existing(c, destination);
      const now = await (await c.backend()).folderMove(from, into);
      c.out.value({ folder: now, was: from }, () => `${folderLabel(from)} is now ${folderLabel(now)}`);
    });

  folders
    .command('delete')
    .alias('rm')
    .description('remove a folder that holds nothing — no folder command ever takes a note with it')
    .argument('<folder>', 'the folder to remove')
    .action(async (folder: string) => {
      const c = ctx();
      const gone = await realFolder(c, folder, 'deleted');
      await (await c.backend()).folderDelete(gone);
      c.out.value({ folder: gone, deleted: true }, () => `Deleted ${folderLabel(gone)}`);
    });
}
