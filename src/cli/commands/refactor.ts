import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT, type ExitCode } from '../../core/ipc-protocol';
import { headingLineOf, planMerge, planMoveSection, planRefile, planTagRename, type PlanErrorCode, type PlanResult, type Target } from '../../core/refactor';
import { titleOf } from '../../renderer/notes';
import type { Note } from '../../shared/types';
import type { Ctx } from '../context';
import type { Column } from '../output';

/**
 * Changes that touch more than one note: moving lines or a section into
 * another note, renaming a tag everywhere, merging two notes (and `rename`,
 * in notes.ts, which points the links at the new name). Each is planned by
 * src/core/refactor.ts, shown whole with --dry-run, and applied through the
 * backend: the files when the app is not running, the window when it is, so
 * that the change is undoable there as one step.
 */

export interface PlanOpts {
  dryRun?: boolean;
  force?: boolean;
}

const EXIT_FOR: Record<PlanErrorCode, ExitCode> = {
  not_found: EXIT.notFound,
  heading_not_found: EXIT.notFound,
  not_in_section: EXIT.notFound,
  bad_tag: EXIT.usage,
  same_note: EXIT.usage,
  nothing_selected: EXIT.usage,
  nothing_to_do: EXIT.usage,
};

const TOUCHED_COLUMNS: Column[] = [
  { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
  { key: 'title', label: 'title', style: 'bold' },
  { key: 'changes', label: 'changes', format: (v) => (v as string[]).join(', '), style: 'dim' },
];

/** The Plan's sentence once it has been done. */
const done = (sentence: string): string =>
  sentence
    .replace(/^Move /, 'Moved ')
    .replace(/^Rename /, 'Renamed ')
    .replace(/^Merge /, 'Merged ')
    .replace(/ and update /, ' and updated ')
    .replace(/ and move /, ' and moved ');

/** Shows a Plan for --dry-run, or applies it and reports; a planning failure becomes the exit code it deserves. */
export async function settlePlan(c: Ctx, result: PlanResult, opts: PlanOpts): Promise<void> {
  if (!result.ok) throw new CliError(result.message, EXIT_FOR[result.code]);
  const { plan } = result;
  if (opts.dryRun) {
    if (c.out.mode === 'json') {
      c.out.value(plan, () => '');
      return;
    }
    if (c.out.mode === 'pretty') c.out.write(`${plan.sentence} — nothing written (dry run)`);
    else c.out.message(`${plan.sentence} — nothing written (dry run)`);
    c.out.rows(plan.touched, TOUCHED_COLUMNS);
    return;
  }
  const applied = await (await c.backend()).applyPlan(plan, { force: opts.force });
  c.out.value({ kind: plan.kind, sentence: plan.sentence, summary: plan.summary, touched: plan.touched, applied: applied.applied }, () => done(plan.sentence));
}

/** Where `--under` and `--top` point in the destination: a heading found by its words, made at the end when missing. */
function targetFor(to: Note, opts: { under?: string; top?: boolean }): { target: Target; createHeading?: string } {
  if (opts.top) return { target: 'top' };
  if (opts.under?.trim()) {
    const line = headingLineOf(to.body, opts.under);
    return line >= 0 ? { target: { line } } : { target: 'end', createHeading: opts.under.trim() };
  }
  return { target: 'end' };
}

/** `N` or `N-M`, counted from 1, as a 0-based inclusive range. */
function parseLines(text: string, count: number): { first: number; last: number } {
  const m = /^(\d+)(?:-(\d+))?$/.exec(text.trim());
  if (!m) throw new CliError(`--lines wants a line number or a range, as 4 or 4-6 (counted from 1)`, EXIT.usage);
  const first = Number(m[1]) - 1;
  const last = m[2] ? Number(m[2]) - 1 : first;
  if (first < 0 || last < first || last >= count) throw new CliError(`The note has ${count} ${count === 1 ? 'line' : 'lines'}; ${text} is not in it`, EXIT.usage);
  return { first, last };
}

/** The first line holding every word, case-insensitive. */
function matchLine(note: Note, words: string): number {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new CliError('--match wants some words', EXIT.usage);
  const at = note.body.split('\n').findIndex((line) => {
    const lower = line.toLowerCase();
    return terms.every((t) => lower.includes(t));
  });
  if (at < 0) throw new CliError(`No line of "${titleOf(note)}" has ${terms.map((t) => `"${t}"`).join(' and ')}`, EXIT.notFound);
  return at;
}

const targetOptions = (cmd: Command): Command =>
  cmd
    .option('--under <heading>', 'put it at the end of the section under this heading (made at the end when missing)')
    .option('--top', 'put it at the top of the note instead of the end')
    .option('--dry-run', 'show what would change, and change nothing')
    .option('--force', 'go ahead even while a note involved is being typed in the window');

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  targetOptions(
    program
      .command('refile')
      .description('move lines from one note into another, under a heading if you say which')
      .argument('<from>', 'the note to take the lines from')
      .argument('<to>', 'the note to put them in')
      .option('--lines <range>', 'which lines, as 4 or 4-6, counted from 1')
      .option('--match <words>', 'the first line holding these words'),
  ).action(async (fromSel: string, toSel: string, opts: { lines?: string; match?: string; under?: string; top?: boolean } & PlanOpts) => {
    const c = ctx();
    const notes = await (await c.backend()).notes();
    const from = await c.note(fromSel, notes);
    const to = await c.note(toSel, notes);
    let range: { first: number; last: number };
    if (opts.lines) range = parseLines(opts.lines, from.body.split('\n').length);
    else if (opts.match !== undefined) {
      const at = matchLine(from, opts.match);
      range = { first: at, last: at };
    } else throw new CliError('Say which lines: --lines 4 (or 4-6), or --match "some words"', EXIT.usage);
    await settlePlan(c, planRefile(notes, { from: from.id, ...range, to: to.id, ...targetFor(to, opts) }), opts);
  });

  const section = program.command('section').description('a heading and everything under it, as one piece');
  targetOptions(
    section
      .command('move')
      .description('move a section (its heading through the next heading of the same level) into another note')
      .argument('<from>', 'the note the section is in')
      .argument('<heading>', 'the words of its heading')
      .argument('<to>', 'the note to put it in'),
  ).action(async (fromSel: string, heading: string, toSel: string, opts: { under?: string; top?: boolean } & PlanOpts) => {
    const c = ctx();
    const notes = await (await c.backend()).notes();
    const from = await c.note(fromSel, notes);
    const to = await c.note(toSel, notes);
    const line = headingLineOf(from.body, heading);
    if (line < 0) throw new CliError(`No heading "${heading}" in "${titleOf(from)}"`, EXIT.notFound);
    await settlePlan(c, planMoveSection(notes, { from: from.id, line, to: to.id, ...targetFor(to, opts) }), opts);
  });

  const tag = program.commands.find((cmd) => cmd.name() === 'tag') ?? program.command('tag').description('add, remove or rename a #tag');
  tag.description('add, remove or rename a #tag');
  tag
    .command('rename')
    .description('rename a tag in every note that carries it, nested tags included')
    .argument('<old>', 'the tag as it is, with or without #')
    .argument('<new>', 'the new name')
    .option('--dry-run', 'show what would change, and change nothing')
    .option('--force', 'go ahead even while a note involved is being typed in the window')
    .action(async (from: string, to: string, opts: PlanOpts) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      await settlePlan(c, planTagRename(notes, { from, to }), opts);
    });

  program
    .command('merge')
    .description('append one note to another, point its links at the survivor, and move it to the trash')
    .argument('<source>', 'the note to merge away')
    .argument('<into>', 'the note that keeps everything')
    .option('--dry-run', 'show what would change, and change nothing')
    .option('--force', 'go ahead even while a note involved is being typed in the window')
    .action(async (sourceSel: string, intoSel: string, opts: PlanOpts) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const source = await c.note(sourceSel, notes);
      const into = await c.note(intoSel, notes);
      await settlePlan(c, planMerge(notes, { source: source.id, into: into.id }), opts);
    });
}
