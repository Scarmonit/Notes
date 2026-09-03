import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { toggleFence } from '../../renderer/fences';
import { findMatches, replaceAll, replaceOne, validQuery, type FindOptions } from '../../renderer/find';
import { titleOf, updateBody } from '../../renderer/notes';
import { headingsIn } from '../../renderer/outline';
import { markdownToText } from '../../renderer/plaintext';
import { cycleTaskLine, tasksIn, toggleTaskLine } from '../../renderer/tasks';
import { describe, type Ctx } from '../context';
import { save } from './notes';

/** Working inside one note's text: tasks, fences, find, replace, outline, render. */

/** `3-9`, `3`, `3-`: a line range, 1-based, inclusive. */
export function parseRange(text: string, lineCount: number): { first: number; last: number } {
  const m = /^(\d+)(?:-(\d*))?$/.exec(text.trim());
  if (!m) throw new CliError(`--lines wants a line or a range such as 3-9; got "${text}"`, EXIT.usage);
  const first = Number(m[1]);
  const last = m[2] === undefined ? first : m[2] === '' ? lineCount : Number(m[2]);
  if (first < 1 || last < first) throw new CliError(`Bad line range "${text}"`, EXIT.usage);
  return { first, last };
}

/** Line and column (1-based) of an offset in a text. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, col };
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  program
    .command('tasks')
    .description('the checklist items in a note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--todo', 'only the ones not done')
    .option('--done', 'only the ones done')
    .action(async (selector: string, opts: { todo?: boolean; done?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const lines = note.body.split('\n');
      const rows = tasksIn(note.body)
        .map((t, i) => ({ n: i + 1, line: t.line + 1, done: t.done, text: lines[t.line].replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '') }))
        .filter((t) => (opts.todo ? !t.done : opts.done ? t.done : true));
      c.out.rows(rows, [
        { key: 'n', label: '#', align: 'right', style: 'dim' },
        { key: 'done', label: '', format: (v) => (v ? '[x]' : '[ ]') },
        { key: 'text', label: 'task', shrink: true },
        { key: 'line', label: 'line', align: 'right', style: 'dim' },
      ]);
    });

  program
    .command('task')
    .description('tick, untick or toggle a checklist item; or turn a line into one')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<which>', 'the task number (1 is the first), or line:N for a line of the note')
    .option('--toggle', 'flip it (default)')
    .option('--done', 'tick it')
    .option('--undo', 'untick it')
    .option('--cycle', 'plain line → task → done → plain line, as Ctrl+Shift+X does')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, which: string, opts: { toggle?: boolean; done?: boolean; undo?: boolean; cycle?: boolean; force?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const tasks = tasksIn(note.body);
      let line: number;
      const byLine = /^line:(\d+)$/i.exec(which);
      if (byLine) line = Number(byLine[1]) - 1;
      else {
        const n = Number(which);
        if (!Number.isInteger(n) || n < 1) throw new CliError(`Which task? A number from 1 to ${tasks.length}, or line:N`, EXIT.usage);
        const task = tasks[n - 1];
        if (!task) throw new CliError(`"${titleOf(note)}" has ${tasks.length} tasks; there is no task ${n}`, EXIT.notFound);
        line = task.line;
      }
      let body: string;
      if (opts.cycle) body = cycleTaskLine(note.body, line);
      else {
        const task = tasks.find((t) => t.line === line);
        if (!task) throw new CliError(`Line ${line + 1} is not a checklist item; --cycle makes it one`, EXIT.usage);
        if (opts.done) body = task.done ? note.body : toggleTaskLine(note.body, line);
        else if (opts.undo) body = task.done ? toggleTaskLine(note.body, line) : note.body;
        else body = toggleTaskLine(note.body, line);
      }
      const saved = body === note.body ? note : await save(c, updateBody([note], note.id, body)[0], opts.force);
      const after = tasksIn(saved.body).find((t) => t.line === line);
      c.out.value({ id: saved.id, line: line + 1, done: after?.done ?? null, text: saved.body.split('\n')[line] }, () => saved.body.split('\n')[line] ?? '');
    });

  program
    .command('fence')
    .description('put a code block around lines (or take one away when they are already fenced)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .requiredOption('--lines <range>', 'the lines, such as 3-9 (1 is the first line)')
    .option('--lang <name>', 'the language, for highlighting: ps1, js, sql…')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, opts: { lines: string; lang?: string; force?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const count = note.body.split('\n').length;
      const { first, last } = parseRange(opts.lines, count);
      if (first > count) throw new CliError(`"${titleOf(note)}" has ${count} lines`, EXIT.usage);
      const fenced = toggleFence(note.body, first - 1, last - 1, opts.lang ?? '');
      const saved = await save(c, updateBody([note], note.id, fenced.body)[0], opts.force);
      c.out.value(describe(saved), () => `Fenced lines ${first}-${Math.min(last, count)} of "${titleOf(saved)}"`);
    });

  program
    .command('find')
    .description('find text in a note; each hit as line:col')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<query>', 'the text, or a pattern with --regex')
    .option('--regex', 'the query is a regular expression')
    .option('--case', 'match case')
    .action(async (selector: string, query: string, opts: { regex?: boolean; case?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const fo: FindOptions = { regex: opts.regex === true, caseSensitive: opts.case === true };
      if (!validQuery(query, fo)) throw new CliError(`"${query}" is not a valid ${opts.regex ? 'pattern' : 'query'}`, EXIT.usage);
      const lines = note.body.split('\n');
      const rows = findMatches(note.body, query, fo).map((m) => {
        const { line, col } = lineCol(note.body, m.start);
        return { line, col, start: m.start, end: m.end, match: note.body.slice(m.start, m.end), text: lines[line - 1] };
      });
      c.out.rows(rows, [
        { key: 'line', label: 'line', align: 'right', format: (_v, r) => `${r.line}:${r.col}`, style: 'dim' },
        { key: 'text', label: 'text', shrink: true },
      ]);
      if (rows.length === 0 && c.out.mode !== 'json') c.exitCode = EXIT.notFound;
    });

  program
    .command('replace')
    .description('replace text in a note (the first match, or every one with --all)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<query>', 'the text, or a pattern with --regex')
    .argument('<replacement>', 'what to put there ($1 for groups with --regex)')
    .option('--all', 'every match')
    .option('--regex', 'the query is a regular expression')
    .option('--case', 'match case')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, query: string, replacement: string, opts: { all?: boolean; regex?: boolean; case?: boolean; force?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const fo: FindOptions = { regex: opts.regex === true, caseSensitive: opts.case === true };
      if (!validQuery(query, fo)) throw new CliError(`"${query}" is not a valid ${opts.regex ? 'pattern' : 'query'}`, EXIT.usage);
      let body: string;
      let count: number;
      if (opts.all) ({ text: body, count } = replaceAll(note.body, query, replacement, fo));
      else {
        const first = findMatches(note.body, query, fo)[0];
        body = first ? replaceOne(note.body, first, query, replacement, fo) : note.body;
        count = first ? 1 : 0;
      }
      if (count === 0) {
        c.out.value({ id: note.id, replaced: 0 }, () => 'No match');
        c.exitCode = EXIT.notFound;
        return;
      }
      const saved = await save(c, updateBody([note], note.id, body)[0], opts.force);
      c.out.value({ ...describe(saved), replaced: count }, () => `Replaced ${count} in "${titleOf(saved)}"`);
    });

  program
    .command('outline')
    .description('the headings of a note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--tree', 'indented by level (default in a terminal)')
    .option('--flat', 'one heading per line, no indent')
    .action(async (selector: string, opts: { tree?: boolean; flat?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      const rows = headingsIn(note.body).map((h) => ({ level: h.level, text: h.text, line: h.line + 1 }));
      const indent = !opts.flat;
      c.out.rows(rows, [
        { key: 'text', label: 'heading', format: (v, r) => `${indent ? '  '.repeat(Number(r.level) - 1) : ''}${String(v)}` },
        { key: 'line', label: 'line', align: 'right', style: 'dim' },
        { key: 'level', label: 'h', align: 'right', style: 'dim' },
      ]);
    });

  program
    .command('render')
    .description('a note as HTML (as the preview shows it) or as readable plain text')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--html', 'HTML (default)')
    .option('--text', 'plain text, as the .txt export writes it')
    .action(async (selector: string, opts: { html?: boolean; text?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      if (opts.text) {
        const text = markdownToText(note.body);
        c.out.value({ id: note.id, text }, () => text);
        return;
      }
      const html = await backend.renderHtml(note.body);
      c.out.value({ id: note.id, html }, () => html);
    });
}
