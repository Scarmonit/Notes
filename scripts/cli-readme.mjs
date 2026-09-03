// Regenerates the command table in README.md from the CLI's own definitions:
// builds the bundle, asks it for the reference, and splices the result
// between the cli:start / cli:end markers. Run after changing a command.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx', ['vite', 'build', '--config', 'vite.cli.config.ts'], { cwd: root, stdio: 'ignore', shell: true });
const table = execFileSync(process.execPath, [path.join(root, '.vite', 'build', 'cli.js'), '__docs'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

const readme = path.join(root, 'README.md');
const text = fs.readFileSync(readme, 'utf8');
const start = '<!-- cli:start -->';
const end = '<!-- cli:end -->';
const a = text.indexOf(start);
const b = text.indexOf(end);
if (a < 0 || b < 0) throw new Error('README.md has no cli:start / cli:end markers');
const next = `${text.slice(0, a + start.length)}\n${table.trim()}\n${text.slice(b)}`;
fs.writeFileSync(readme, next, 'utf8');
console.log(`README.md: ${table.trim().split('\n').length} lines of command reference`);
