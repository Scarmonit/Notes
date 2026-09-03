// @vitest-environment node
import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The built bundle, run as a real child process: stdin through a pipe,
 * stdout captured, exit codes read back. The packaged app runs the very
 * same file on its own binary; only the runtime differs.
 */

const projectRoot = path.resolve(__dirname, '..', '..');
const cli = path.join(projectRoot, '.vite', 'build', 'cli.js');
let root: string;

beforeAll(async () => {
  await execa('npx', ['vite', 'build', '--config', 'vite.cli.config.ts'], { cwd: projectRoot, stdio: 'ignore', shell: true });
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-e2e-'));
}, 120_000);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const notes = (args: string[], options: { input?: string } = {}) =>
  execa(process.execPath, [cli, '--no-app', '--user-data-dir', root, ...args], {
    cwd: projectRoot,
    reject: false,
    input: options.input,
    env: { ...process.env, NO_COLOR: '1', COLUMNS: '100' },
  });

describe('notes (end to end)', () => {
  it('takes a note from stdin, normalising Windows line endings', async () => {
    const made = await notes(['new', 'Piped', '-'], { input: 'line one\r\nline two\r\n' });
    expect(made.exitCode).toBe(0);
    const shown = await notes(['show', 'piped', '--body']);
    expect(shown.stdout).toBe('line one\nline two');
  });

  it('files piped text in the Inbox', async () => {
    const r = await notes(['inbox'], { input: 'call the bank\r\n' });
    expect(r.exitCode).toBe(0);
    const shown = await notes(['show', 'inbox', '--body']);
    expect(shown.stdout).toBe('call the bank');
  });

  it('keeps quoting: spaces, percent signs and ampersands survive', async () => {
    const text = 'a & b, 100% "quoted" text';
    expect((await notes(['new', 'Quoted', '--content', text])).exitCode).toBe(0);
    expect((await notes(['show', 'quoted', '--body'])).stdout).toBe(text);
  });

  it('exits 3 for a missing note and 2 for a usage error', async () => {
    expect((await notes(['show', 'nope'])).exitCode).toBe(3);
    expect((await notes(['show'])).exitCode).toBe(2);
    expect((await notes(['nonsense'])).exitCode).toBe(2);
  });

  it('prints plain rows when piped, so findstr-style filtering works', async () => {
    const r = await notes(['list']);
    expect(r.stdout.split('\n').every((line) => line.split('\t').length >= 3)).toBe(true);
    expect(r.stdout).not.toContain('[');
  });

  it('feeds a listed id back through stdin with -', async () => {
    const r = await notes(['show', '-', '--title'], { input: (await notes(['list', '--plain'])).stdout.split('\n')[0] });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });

  it('shows help the same way every time', async () => {
    const r = await notes(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatchSnapshot();
  });

  it('starts quickly', async () => {
    const start = Date.now();
    await notes(['--version']);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe('notes 0.13 (end to end)', () => {
  it('writes an HTML export carrying the app stylesheet and the math fonts', async () => {
    expect((await notes(['new', 'Formula', '--content', 'Mass: $E=mc^2$ #physics'])).exitCode).toBe(0);
    const out = path.join(root, 'formula.html');
    expect((await notes(['export', 'formula', '--html', '-o', out])).exitCode).toBe(0);
    const html = await fs.readFile(out, 'utf8');
    expect(html).toContain('class="katex"');
    expect(html).toContain('data:font/woff2;base64');
    expect(html).toContain('--ink:');
    expect(html.length).toBeGreaterThan(100_000);
  });

  it('answers the search-box operators on the command line', async () => {
    expect((await notes(['new', 'Errands', '--content', '- [ ] post office @2030-01-01'])).exitCode).toBe(0);
    const r = await notes(['list', '--plain', 'due:any', 'todo:']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Errands');
    expect((await notes(['due', 'any', '--plain'])).stdout).toContain('post office');
  });
});
