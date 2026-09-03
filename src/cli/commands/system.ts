import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CliError } from '../../core/backend';
import { EXIT, PROTOCOL } from '../../core/ipc-protocol';
import { installCli, layoutFor, shimStatus, uninstallCli } from '../../core/shim';
import { titleOf } from '../../renderer/notes';
import type { ExternalChanges } from '../../shared/types';
import { appRunning, canSpawnApp } from '../client';
import { type Ctx } from '../context';
import { iso } from '../output';

/** Paths, the folder, watching, the command's own installation, and version. */

/** The folder the app is installed in: this binary's folder when running as the app. */
export function appDir(): string | null {
  return canSpawnApp() ? path.dirname(process.execPath) : null;
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  program
    .command('path')
    .description('where the notes live (or the trash, history, attachments, settings)')
    .argument('[which]', 'notes (default), trash, history, attachments, settings, root')
    .action(async (which = 'notes') => {
      const c = ctx();
      const p = await (await c.backend()).paths();
      if (!(which in p)) throw new CliError(`Which path? One of ${Object.keys(p).join(', ')}`, EXIT.usage);
      c.out.value(p, () => p[which as keyof typeof p]);
    });

  program
    .command('folder')
    .description('open the notes folder in Explorer')
    .action(async () => {
      const c = ctx();
      const p = await (await c.backend()).paths();
      const child = spawn('explorer.exe', [p.notes], { detached: true, stdio: 'ignore' });
      child.unref();
      c.out.message(p.notes);
    });

  program
    .command('watch')
    .description('print changes to the notes as they happen, until Ctrl+C')
    .action(async () => {
      const c = ctx();
      const backend = await c.backend();
      const controller = new AbortController();
      const stop = (): void => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      c.out.message(`Watching ${backend.mode === 'app' ? 'through Notes' : (await backend.paths()).notes}… Ctrl+C stops`);
      await backend.watch((changes: ExternalChanges) => {
        const at = iso(Date.now());
        for (const note of changes.upserts) {
          const row = { at, event: 'update', id: note.id, title: titleOf(note) };
          if (c.out.mode === 'json') c.out.write(JSON.stringify(row));
          else c.out.write(`${c.out.dim(at)}\tupdate\t${note.id}\t${titleOf(note)}`);
        }
        for (const id of changes.removed) {
          const row = { at, event: 'delete', id };
          if (c.out.mode === 'json') c.out.write(JSON.stringify(row));
          else c.out.write(`${c.out.dim(at)}\tdelete\t${id}`);
        }
      }, controller.signal);
    });

  const cli = program.command('cli').description('the `notes` command itself: put it on PATH, take it off, or check');
  cli
    .command('status', { isDefault: true })
    .description('where the launcher is, what it points at, and whether PATH has it')
    .action(() => {
      const c = ctx();
      const dir = appDir();
      if (!dir) throw new CliError('Not running from an installed Notes; nothing to report', EXIT.usage);
      const status = shimStatus(layoutFor(dir));
      c.out.value({ appDir: dir, ...status }, () =>
        [
          `launcher   ${status.installed ? status.binDir : 'not installed'}`,
          `points at  ${status.target ?? '—'}${status.installed && !status.current ? ' (not this version; run `notes cli install`)' : ''}`,
          `user PATH  ${status.onPath ? 'yes' : 'no'}`,
          `this shell ${status.onSessionPath ? 'yes' : 'no (open a new terminal)'}`,
        ].join('\n'),
      );
      if (!status.installed || !status.onPath) c.exitCode = EXIT.failure;
    });
  cli
    .command('install')
    .description('write the launcher beside the app and add it to your PATH')
    .action(() => {
      const c = ctx();
      const dir = appDir();
      if (!dir) throw new CliError('Not running from an installed Notes; run this through the app\'s own `notes` command', EXIT.usage);
      const layout = layoutFor(dir);
      const done = installCli(layout);
      c.out.value({ ...done, binDir: layout.binDir }, () => (done.addedToPath ? `Installed to ${layout.binDir} and added to PATH; open a new terminal to use it` : `Installed to ${layout.binDir} (already on PATH)`));
    });
  cli
    .command('uninstall')
    .description('remove the launcher and take it off your PATH')
    .action(() => {
      const c = ctx();
      const dir = appDir();
      if (!dir) throw new CliError('Not running from an installed Notes', EXIT.usage);
      const layout = layoutFor(dir);
      const done = uninstallCli(layout);
      c.out.value({ ...done, binDir: layout.binDir }, () => `Removed ${layout.binDir}${done.removedFromPath ? ' and took it off PATH' : ''}`);
    });

  program
    .command('version')
    .description('the versions of this command, the app it belongs to, and whether the app is running')
    .action(async () => {
      const c = ctx();
      const running = appRunning(c.userData);
      const record = {
        cli: c.version,
        protocol: PROTOCOL,
        app: running ? running.version : null,
        appProtocol: running ? running.protocol : null,
        running: running !== null,
        pid: running?.pid ?? null,
        userData: c.userData,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
      };
      c.out.value(record, () =>
        [
          `notes ${c.version} (protocol ${PROTOCOL})`,
          running ? `Notes ${running.version} is running (pid ${running.pid}, protocol ${running.protocol})` : 'Notes is not running',
          c.out.dim(`data: ${c.userData}`),
        ].join('\n'),
      );
    });
}
