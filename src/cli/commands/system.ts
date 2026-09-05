import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CliError } from '../../core/backend';
import { EXIT, PROTOCOL } from '../../core/ipc-protocol';
import { defaultUserData, forgetNotesFolder, pathsFor } from '../../core/paths';
import { installCli, layoutFor, shimStatus, uninstallCli } from '../../core/shim';
import { countNotes, moveInto, notHidden } from '../../core/vault';
import { isNoteFileName } from '../../shared/notes-folder';
import { titleOf } from '../../renderer/notes';
import type { ExternalChanges } from '../../shared/types';
import { serve } from '../../mcp/server';
import { appRunning, canSpawnApp, connectBackend } from '../client';
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
    .description('where the markdown files are kept, and where to keep them')
    .argument('[path]', 'keep them in this folder from now on; "default" puts them back beside the app’s own files')
    .option('--open', 'open the folder in Explorer')
    .option('--move', 'move the notes into the new folder even when it already holds some')
    .action(async (target: string | undefined, opts: { open?: boolean; move?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      if (target === undefined) {
        const p = await backend.paths();
        if (opts.open) {
          const child = spawn('explorer.exe', [p.notes], { detached: true, stdio: 'ignore' });
          child.unref();
        }
        c.out.value({ folder: p.notes }, () => p.notes);
        return;
      }
      const settings = await backend.settingsGet();
      const wanted = /^(default|none|-)$/i.test(target) ? null : path.resolve(target);
      const from = pathsFor(defaultUserData(), settings.notesFolder);
      const to = pathsFor(defaultUserData(), wanted);
      if (path.resolve(from.notes) === path.resolve(to.notes)) {
        c.out.value({ folder: to.notes, moved: 0 }, () => `The notes are already in ${to.notes}`);
        return;
      }
      // A folder that already holds notes is taken as it is: pointing Notes
      // at a notebook it already syncs must not merge two notebooks together.
      const already = await countNotes(to.notes);
      let moved = 0;
      if (already === 0 || opts.move) {
        moved = await moveInto(from.notes, to.notes, isNoteFileName);
        await moveInto(from.attachments, to.attachments, notHidden);
      }
      await backend.settingsSet({ ...settings, notesFolder: wanted });
      forgetNotesFolder();
      c.out.value({ folder: to.notes, moved, found: already }, () =>
        moved > 0
          ? `${moved} ${moved === 1 ? 'note' : 'notes'} moved to ${to.notes}`
          : already > 0
            ? `${already} ${already === 1 ? 'note' : 'notes'} already in ${to.notes}; Notes will use them`
            : `The notes will be kept in ${to.notes}`,
      );
      if (backend.mode === 'app') c.out.message('The window is still reading the old folder; start Notes again to see them there');
    });

  program
    .command('mcp')
    .description('speak the Model Context Protocol on stdin and stdout, so an assistant can read and write these notes')
    .option('--print-config', 'print the JSON an MCP client wants, instead of running')
    .action(async (opts: { printConfig?: boolean }) => {
      const c = ctx();
      const command = process.execPath;
      const args = [...(process.argv[1] ? [process.argv[1]] : []), 'mcp', ...(c.explicitUserData ? ['--user-data-dir', c.userData] : [])];
      if (opts.printConfig) {
        // In an installed build the executable is Notes.exe, and it only runs
        // this file as Node because the `notes` launcher sets this first. A
        // config without it starts the app's window instead of a server, and
        // the client waits for a protocol that never speaks.
        const config = {
          mcpServers: { notes: process.versions.electron ? { command, args, env: { ELECTRON_RUN_AS_NODE: '1' } } : { command, args } },
        };
        c.out.value(config, () => JSON.stringify(config, null, 2));
        c.out.message('Add it with:  claude mcp add notes -- notes mcp');
        return;
      }
      // stdout is the protocol from here on: nothing else may write to it.
      await serve(
        {
          version: c.version,
          log: (text) => process.stderr.write(`${text}\n`),
          // A connection per call, so the server follows the app being opened
          // and closed underneath it rather than holding a stale pipe.
          open: () =>
            connectBackend({
              userData: c.userData,
              explicitUserData: c.explicitUserData,
              cliVersion: c.version,
              app: c.appPolicy,
              needsApp: false,
              log: () => undefined,
            }),
        },
        process.stdin,
        process.stdout,
      );
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
      c.exitCode = 130;
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
