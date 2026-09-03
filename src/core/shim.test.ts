// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutFor, pathContains, removeShim, shimFiles, shimStatus, writeShim } from './shim';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-shim-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('layoutFor', () => {
  it('puts bin beside Update.exe for a Squirrel install, inside the folder otherwise', () => {
    const app = path.join(root, 'app-1.2.3');
    fs.mkdirSync(app);
    expect(layoutFor(app).binDir).toBe(path.join(app, 'bin'));
    fs.writeFileSync(path.join(root, 'Update.exe'), '');
    expect(layoutFor(app).binDir).toBe(path.join(root, 'bin'));
  });
});

describe('shimFiles', () => {
  it('never bakes the version into the launchers, only into current.cmd', () => {
    const files = shimFiles(layoutFor(path.join(root, 'app-9.9.9')));
    const cmd = files.find((f) => f.name === 'notes.cmd')?.text ?? '';
    const ps1 = files.find((f) => f.name === 'notes.ps1')?.text ?? '';
    const current = files.find((f) => f.name === 'current.cmd')?.text ?? '';
    expect(cmd).not.toContain('9.9.9');
    expect(ps1).not.toContain('9.9.9');
    expect(current).toContain('app-9.9.9');
    expect(cmd).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(cmd).toContain('exit /b %ERRORLEVEL%');
    expect(ps1).toContain('$input |');
    expect(ps1).toContain('exit $LASTEXITCODE');
    // PowerShell never waits for a GUI exe, so the twin must go through cmd.exe and the batch file.
    expect(ps1).not.toContain('Notes.exe');
    expect(ps1).toContain('$env:ComSpec /d /c call');
  });
});

describe('writeShim / shimStatus', () => {
  it('writes the three files and reports what they point at', () => {
    const app = path.join(root, 'app-1.0.0');
    fs.mkdirSync(app);
    const layout = layoutFor(app);
    writeShim(layout);
    const status = shimStatus(layout);
    expect(status.installed).toBe(true);
    expect(status.target).toBe(app);
    expect(status.current).toBe(true);
    const newer = layoutFor(path.join(root, 'app-2.0.0'));
    // A newer app looking at the old launcher sees it points elsewhere.
    expect(shimStatus({ ...newer, binDir: layout.binDir }).current).toBe(false);
    removeShim(layout);
    expect(shimStatus(layout).installed).toBe(false);
  });
});

describe('pathContains', () => {
  it('compares entries whole, case-insensitively, ignoring trailing slashes', () => {
    expect(pathContains('C:\\a;C:\\Users\\x\\AppData\\Local\\Notes\\bin\\;C:\\b', 'c:\\users\\x\\appdata\\local\\notes\\bin')).toBe(true);
    expect(pathContains('C:\\a;C:\\Users\\x\\AppData\\Local\\Notes\\binary', 'C:\\Users\\x\\AppData\\Local\\Notes\\bin')).toBe(false);
    expect(pathContains('', 'C:\\x')).toBe(false);
  });
});
