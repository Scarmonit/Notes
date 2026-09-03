import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The `notes` command on PATH: two tiny launchers in a `bin` folder beside
 * the app, plus that folder in the user's PATH. The launchers never encode
 * a version — `current.cmd` names the app folder of the moment and is
 * rewritten by every install and update — so an old shim always runs the
 * new app.
 *
 * Used by three callers with the same rules: the Squirrel install and
 * update hooks, `notes cli install`, and the Layout sheet's button.
 */

export interface ShimLayout {
  /** The folder holding Notes.exe and resources\. */
  appDir: string;
  /** Where the launchers go. */
  binDir: string;
  /** The app's executable. */
  exe: string;
  /** The CLI bundle inside the app. */
  cli: string;
}

/** The launchers live beside a Squirrel install's Update.exe, or inside a loose folder. */
export function layoutFor(appDir: string): ShimLayout {
  const parent = path.dirname(appDir);
  const squirrel = fs.existsSync(path.join(parent, 'Update.exe'));
  return {
    appDir,
    binDir: path.join(squirrel ? parent : appDir, 'bin'),
    exe: path.join(appDir, 'Notes.exe'),
    cli: path.join(appDir, 'resources', 'app.asar', '.vite', 'build', 'cli.js'),
  };
}

/** The text of each launcher, for a given app folder. */
export function shimFiles(layout: ShimLayout): Array<{ name: string; text: string }> {
  const current = `@set "NOTES_APP=${layout.appDir}"\r\n`;
  const cmd = [
    '@echo off',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    'set ELECTRON_NO_ATTACH_CONSOLE=',
    'call "%~dp0current.cmd"',
    '"%NOTES_APP%\\Notes.exe" "%NOTES_APP%\\resources\\app.asar\\.vite\\build\\cli.js" %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  // PowerShell does not wait for a GUI-subsystem exe, so it must not run
  // Notes.exe itself: $LASTEXITCODE would come back empty and a pipeline
  // would close before the output arrived. cmd.exe is a console program
  // that waits for the batch file's child, so the twin goes through it —
  // with the batch path in an environment variable, because cmd strips
  // the outer quotes of a /c string that begins with one. `$input |`
  // carries a pipeline's stdin through, the way npm's shims do.
  const ps1 = [
    '$env:NOTES_LAUNCHER = Join-Path $PSScriptRoot "notes.cmd"',
    // PowerShell hands cmd.exe embedded quotes bare; escaping them keeps a "quoted" word whole.
    "$a = @($args | ForEach-Object { if ($_ -is [string]) { $_ -replace '\"', '\\\"' } else { $_ } })",
    "if ($MyInvocation.ExpectingInput) { $input | & $env:ComSpec /d /c call '\"%NOTES_LAUNCHER%\"' @a }",
    "else { & $env:ComSpec /d /c call '\"%NOTES_LAUNCHER%\"' @a }",
    'exit $LASTEXITCODE',
    '',
  ].join('\r\n');
  return [
    { name: 'current.cmd', text: current },
    { name: 'notes.cmd', text: cmd },
    { name: 'notes.ps1', text: ps1 },
  ];
}

export function writeShim(layout: ShimLayout): void {
  fs.mkdirSync(layout.binDir, { recursive: true });
  for (const file of shimFiles(layout)) fs.writeFileSync(path.join(layout.binDir, file.name), file.text, 'utf8');
}

export function removeShim(layout: ShimLayout): void {
  for (const name of ['current.cmd', 'notes.cmd', 'notes.ps1']) {
    try {
      fs.unlinkSync(path.join(layout.binDir, name));
    } catch {
      // Already gone.
    }
  }
  try {
    fs.rmdirSync(layout.binDir);
  } catch {
    // Not empty, or already gone: either is fine.
  }
}

// --- the user's PATH -----------------------------------------------------------

const REG = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
const KEY = 'HKCU\\Environment';

/** The user's PATH as stored in the registry, unexpanded, or '' when there is none. */
export function readUserPath(): string {
  let out: string;
  try {
    out = execFileSync(REG, ['query', KEY, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out);
  return m ? m[1].trim() : '';
}

/**
 * Writes the user's PATH back, always as REG_EXPAND_SZ so `%USERPROFILE%`
 * entries keep expanding. Never `setx` (which truncates at 1024 characters)
 * and never .NET's SetEnvironmentVariable (which turns the value into a
 * plain REG_SZ).
 */
export function writeUserPath(value: string): void {
  execFileSync(REG, ['add', KEY, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' });
}

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase().replace(/[\\/]+$/, '') === path.resolve(b).toLowerCase().replace(/[\\/]+$/, '');

export function pathContains(value: string, dir: string): boolean {
  return value.split(';').some((entry) => entry.trim() && same(entry.trim(), dir));
}

/** Adds a folder to the user's PATH once. Returns whether anything changed. */
export function addToUserPath(dir: string): boolean {
  const current = readUserPath();
  if (pathContains(current, dir)) return false;
  const next = current.replace(/;+$/, '');
  writeUserPath(next ? `${next};${dir}` : dir);
  broadcastEnvironmentChange();
  return true;
}

/** Takes a folder out of the user's PATH. Returns whether it was there. */
export function removeFromUserPath(dir: string): boolean {
  const current = readUserPath();
  if (!pathContains(current, dir)) return false;
  const kept = current.split(';').filter((entry) => entry.trim() && !same(entry.trim(), dir));
  writeUserPath(kept.join(';'));
  broadcastEnvironmentChange();
  return true;
}

/**
 * Tells Explorer the environment changed, so terminals opened from now on
 * see the new PATH without a sign-out. One line of PowerShell, because
 * SendMessageTimeout is the only way to say it and Node has no native call.
 */
export function broadcastEnvironmentChange(): void {
  const script =
    'Add-Type -Namespace Win32 -Name Env -MemberDefinition \'[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\';' +
    '[UIntPtr]$r = [UIntPtr]::Zero; [void][Win32.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$r)';
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: 'ignore', timeout: 8000 });
  } catch {
    // The change is in the registry either way; a new sign-in picks it up.
  }
}

// --- the three operations ---------------------------------------------------------

export interface ShimStatus {
  binDir: string;
  /** The launchers exist. */
  installed: boolean;
  /** The app folder current.cmd names, when it exists. */
  target: string | null;
  /** current.cmd names this app folder. */
  current: boolean;
  /** bin is in the user's PATH in the registry. */
  onPath: boolean;
  /** bin is in this process's PATH: the terminal will find `notes` right now. */
  onSessionPath: boolean;
}

export function shimStatus(layout: ShimLayout): ShimStatus {
  const installed = ['current.cmd', 'notes.cmd', 'notes.ps1'].every((n) => fs.existsSync(path.join(layout.binDir, n)));
  let target: string | null = null;
  try {
    const m = /NOTES_APP=([^"\r\n]+)/.exec(fs.readFileSync(path.join(layout.binDir, 'current.cmd'), 'utf8'));
    target = m ? m[1] : null;
  } catch {
    target = null;
  }
  return {
    binDir: layout.binDir,
    installed,
    target,
    current: target !== null && same(target, layout.appDir),
    onPath: process.platform === 'win32' && pathContains(readUserPath(), layout.binDir),
    onSessionPath: pathContains(process.env.PATH ?? process.env.Path ?? '', layout.binDir),
  };
}

/** Writes the launchers and puts bin on PATH. Returns what changed. */
export function installCli(layout: ShimLayout): { wroteShim: boolean; addedToPath: boolean } {
  writeShim(layout);
  const addedToPath = process.platform === 'win32' ? addToUserPath(layout.binDir) : false;
  return { wroteShim: true, addedToPath };
}

export function uninstallCli(layout: ShimLayout): { removedShim: boolean; removedFromPath: boolean } {
  const had = fs.existsSync(path.join(layout.binDir, 'notes.cmd'));
  removeShim(layout);
  const removedFromPath = process.platform === 'win32' ? removeFromUserPath(layout.binDir) : false;
  return { removedShim: had, removedFromPath };
}
