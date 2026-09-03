import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { installCli, layoutFor, uninstallCli } from '../core/shim';

/**
 * Squirrel runs the freshly installed exe with one of these flags and waits
 * up to fifteen seconds for it to exit. Each launch does its housekeeping —
 * the Start-menu shortcut, and the `notes` launcher with its PATH entry —
 * and quits. The launcher work is synchronous and takes well under a
 * second; nothing here waits on the app's normal startup.
 *
 * This replaces electron-squirrel-startup, which did the shortcut half.
 */

function updateExe(): string {
  return path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
}

function runUpdate(args: string[], done: () => void): void {
  try {
    spawn(updateExe(), args, { detached: true, stdio: 'ignore' }).on('close', done).on('error', done);
  } catch {
    done();
  }
}

function installLauncher(): void {
  try {
    installCli(layoutFor(path.dirname(process.execPath)));
  } catch (err) {
    // The app must install even if the launcher cannot; the Layout sheet
    // and `notes cli install` can try again.
    console.error('[notes] could not install the notes command', err);
  }
}

function removeLauncher(): void {
  try {
    uninstallCli(layoutFor(path.dirname(process.execPath)));
  } catch (err) {
    console.error('[notes] could not remove the notes command', err);
  }
}

/** Handles a Squirrel launch. True when this launch is one, and the app is on its way out. */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const cmd = process.argv[1];
  const target = path.basename(process.execPath);
  switch (cmd) {
    case '--squirrel-install':
    case '--squirrel-updated':
      installLauncher();
      runUpdate([`--createShortcut=${target}`], () => app.quit());
      return true;
    case '--squirrel-uninstall':
      removeLauncher();
      runUpdate([`--removeShortcut=${target}`], () => app.quit());
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}
