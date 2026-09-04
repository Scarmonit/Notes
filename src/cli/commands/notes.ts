import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { insert, planRename } from '../../core/refactor';
import { parseWords } from '../../core/query';
import { expandTemplate, templateNamed, templatesOf } from '../../core/templates';
import { createNote, snippetOf, tagsOf, titleOf, updateBody, updateTitle, wordCount } from '../../renderer/notes';
import { taskProgress } from '../../renderer/tasks';
import type { Note } from '../../shared/types';
import { AppBackend } from '../client';
import { addFilterOptions, describe, filteredNotes, hasFilterOpts, type Ctx, type FilterOpts } from '../context';
import { editText } from '../editor';
import { gatherBody, normalise } from '../body';
import { settlePlan, type PlanOpts } from './refactor';
import { iso, oneLine, relative, type Column } from '../output';

/** The everyday verbs: making, finding, reading and changing notes. */

const LIST_COLUMNS: Column[] = [
  { key: 'pinned', label: '', format: (v) => (v ? '*' : ' ') },
  { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
  { key: 'updatedAt', label: 'edited', format: (v) => relative(Number(v)), style: 'dim' },
  { key: 'title', label: 'title', style: 'bold' },
  { key: 'snippet', label: '', shrink: true, style: 'dim' },
];

const PLAIN_COLUMNS: Column[] = [
  { key: 'id', label: 'id' },
  { key: 'title', label: 'title' },
  { key: 'updated', label: 'updated' },
  { key: 'tags', label: 'tags', format: (v) => (v as string[]).join(',') },
];

function listRows(ctx: Ctx, notes: Note[], all: Note[]): void {
  const rows = notes.map((n) => describe(n, all));
  ctx.out.rows(rows, ctx.out.mode === 'pretty' ? LIST_COLUMNS : PLAIN_COLUMNS);
}

/** The line of a body the query first appears on, for `search`. */
function matchLine(note: Note, terms: string[]): { line: number; text: string } | null {
  const lines = note.body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((t) => lower.includes(t))) return { line: i + 1, text: oneLine(lines[i]) };
  }
  return null;
}

/** Puts a note through the backend, turning a busy refusal into the hint the person needs. */
export async function save(ctx: Ctx, note: Note, force?: boolean): Promise<Note> {
  return (await ctx.backend()).put(note, { force, expectUpdatedAt: ctx.readAt.get(note.id) });
}

/** The template a name means, expanded for a title; a clear failure when there is no such template. */
export async function templateBody(ctx: Ctx, name: string, title: string): Promise<string> {
  const notes = await (await ctx.backend()).notes();
  const template = templateNamed(notes, name);
  if (!template) {
    const have = templatesOf(notes).map((n) => titleOf(n));
    throw new CliError(have.length > 0 ? `No template "${name}"; there are: ${have.join(', ')}` : `No template "${name}": a template is a note tagged #template`, EXIT.notFound);
  }
  return expandTemplate(template, { title });
}

interface BodyOpts {
  content?: string;
  file?: string;
  edit?: boolean;
  force?: boolean;
}

export function addBodyOptions(cmd: Command): Command {
  return cmd
    .option('-c, --content <text>', 'the text (also: piped in, or --file)')
    .option('-f, --file <path>', 'read the text from a file')
    .option('-e, --edit', 'open $EDITOR for the text')
    .option('--force', 'write even while the note is being edited in the window');
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  addBodyOptions(
    program
      .command('new')
      .alias('add')
      .allowUnknownOption()
      .description('start a note')
      .argument('[title]', 'an explicit title (the first line of the text otherwise)')
      .argument('[text...]', 'the text; - reads stdin')
      .option('--tags <a,b>', 'tags to write on the last line, as #a #b')
      .option('--pin', 'pin the note')
      .option('-T, --template <name>', 'start from a template (a note tagged #template); {{title}}, {{date}} and {{time}} are filled in')
      .option('-o, --open', 'open it in the window'),
  ).action(async (title: string | undefined, words: string[], opts: BodyOpts & { tags?: string; pin?: boolean; template?: string; open?: boolean }) => {
    const c = ctx();
    const dash = words.includes('-') || title === '-';
    const text = words.filter((w) => w !== '-').join(' ');
    const explicitTitle = title && title !== '-' && title.trim() ? title.trim() : '';
    // With a template the words are an addition, not the whole note, so no editor opens for their absence (piped text still counts).
    const given = await gatherBody({ text, content: opts.content, file: opts.file, dash, edit: opts.edit ?? (opts.template !== undefined ? false : undefined), noInput: c.opts.input === false });
    let body = given ?? '';
    if (opts.template) {
      const fromTemplate = await templateBody(c, opts.template, explicitTitle || 'Untitled');
      body = body.trim() ? `${fromTemplate.trimEnd()}\n\n${body.trim()}` : fromTemplate;
    }
    if (opts.tags) {
      const tags = opts.tags
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
        .map((t) => `#${t}`)
        .join(' ');
      if (tags) body = body.trimEnd() ? `${body.trimEnd()}\n\n${tags}` : tags;
    }
    const note = createNote(Date.now(), body);
    if (explicitTitle) note.title = explicitTitle;
    if (opts.pin) note.pinned = true;
    const saved = await save(c, note);
    if (opts.open) await (await c.backend(true)).open({ id: saved.id });
    c.out.value(describe(saved), () => saved.id);
  });

  const list = addFilterOptions(
    program
      .command('list')
      .alias('ls')
      .description('list notes, newest first, pinned on top')
      .argument('[words...]', 'terms every note must contain; #tag, -word, "a phrase", or the search box\'s operators: todo: due:today links:Plan /regex/ sort:title'),
  );
  list.action(async (words: string[], opts: FilterOpts) => {
    const c = ctx();
    const { all, kept } = await filteredNotes(c, opts, words);
    listRows(c, kept, all);
  });

  program
    .command('templates')
    .description('the templates: notes tagged #template, whose {{title}}, {{date}} and {{time}} are filled in by `new --template`')
    .action(async () => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const rows = templatesOf(notes).map((n) => describe(n, notes));
      c.out.rows(rows, [
        { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
        { key: 'title', label: 'template', style: 'bold' },
        { key: 'snippet', label: '', shrink: true, style: 'dim' },
      ]);
      if (rows.length === 0) c.out.message('No templates yet: tag a note #template to make it one');
    });

  addFilterOptions(program.command('search').description('find notes by their words, with the line that matched').argument('<words...>', 'terms; #tag, -word, "a phrase", or operators such as todo: and due:today')).action(
    async (words: string[], opts: FilterOpts) => {
      const c = ctx();
      const { all, kept } = await filteredNotes(c, opts, words);
      const terms = parseWords(words).terms;
      const rows = kept.map((n) => {
        const hit = matchLine(n, terms);
        return { ...describe(n, all), line: hit?.line ?? null, match: hit?.text ?? '' };
      });
      c.out.rows(rows, [
        { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
        { key: 'title', label: 'title', style: 'bold' },
        { key: 'line', label: 'line', align: 'right', format: (v) => (v === null ? '' : String(v)), style: 'dim' },
        { key: 'match', label: 'match', shrink: true },
      ]);
    },
  );

  program
    .command('show')
    .alias('cat')
    .description('print a note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--body', 'just the markdown')
    .option('--title', 'just the title')
    .option('--id', 'just the id')
    .option('--path', 'the file it is stored in')
    .option('--updated', 'when it was last edited (ISO)')
    .option('--created', 'when it was made (ISO)')
    .option('--words', 'the word count')
    .option('--tags', 'its tags, one per line')
    .action(async (selector: string, opts: Record<string, boolean>) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const record = describe(note, await backend.notes());
      const getter = ['body', 'title', 'id', 'updated', 'created', 'words'].find((k) => opts[k]);
      if (opts.path) {
        const file = await backend.fileOf(note.id);
        if (!file) throw new CliError('That note has not been written to a file yet', EXIT.notFound);
        c.out.value({ id: note.id, path: file }, () => file);
        return;
      }
      if (opts.tags) {
        c.out.value(record.tags, () => (record.tags as string[]).join('\n'));
        return;
      }
      if (getter) {
        c.out.value(record[getter], () => String(record[getter]));
        return;
      }
      c.out.value(record, () => {
        if (c.out.mode === 'plain') return note.body;
        const meta = [
          note.id,
          note.pinned ? 'pinned' : '',
          `edited ${relative(note.updatedAt)}`,
          `${record.words} words`,
          (record.tags as string[]).map((t) => `#${t}`).join(' '),
        ]
          .filter(Boolean)
          .join(' · ');
        return `${c.out.bold(titleOf(note))}\n${c.out.dim(meta)}\n\n${note.body}`;
      });
    });

  program
    .command('edit')
    .description('open a note in $EDITOR; saves only if the text changed')
    .argument('[note]', 'id, title, title prefix, filename, or - for stdin')
    .option('-i, --interactive', 'pick the note from a list')
    .option('-w, --wait', 'with --open: wait until the note is closed in the window')
    .option('--open', 'edit in the Notes window instead of $EDITOR')
    .option('--force', 'edit even while the note is open and being typed in')
    .action(async (selector: string | undefined, opts: { interactive?: boolean; wait?: boolean; open?: boolean; force?: boolean }) => {
      const c = ctx();
      const backend = await c.backend(opts.open === true);
      const notes = await backend.notes();
      const note = selector && !opts.interactive ? await c.note(selector, notes) : await c.pick(notes);
      if (opts.open) {
        const app = await c.backend(true);
        await app.open({ id: note.id });
        if (opts.wait && app instanceof AppBackend) await app.waitForClose(note.id);
        return;
      }
      if (!c.interactive()) throw new CliError('edit needs a terminal for $EDITOR; use append, replace-body or --content instead', EXIT.usage);
      const status = await backend.status(note.id);
      if (status.dirty && !opts.force) throw new CliError(`"${titleOf(note)}" is being typed in the window right now; pass --force to edit it anyway`, EXIT.busy);
      const edited = (await editText(note.body)).replace(/\s+$/, '');
      if (edited === note.body) {
        c.out.message('Unchanged');
        return;
      }
      const saved = await save(c, updateBody([note], note.id, edited)[0], opts.force);
      c.out.value(describe(saved), () => `Saved "${titleOf(saved)}"`);
    });

  addBodyOptions(
    program
      .command('append')
      .allowUnknownOption()
      .description('add text to the end of a note (or under a heading, or at the top)')
      .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
      .argument('[text...]', 'the text; - reads stdin')
      .option('--prepend', 'put the text at the top instead')
      .option('--heading <text>', 'put the text at the end of the section under this heading')
      .option('--divider', 'add a section divider (---) instead of, or before, the text')
      .option('--inline', 'continue the last line rather than starting a paragraph')
      .option('-T, --template <name>', 'append a template (a note tagged #template), its {{date}} and {{time}} filled in'),
  ).action(async (selector: string, words: string[], opts: BodyOpts & { prepend?: boolean; heading?: string; divider?: boolean; inline?: boolean; template?: string }) => {
    const c = ctx();
    const dash = words.includes('-');
    const text = words.filter((w) => w !== '-').join(' ');
    const quiet = opts.divider || opts.template !== undefined;
    // A divider or a template stands on its own, so no editor opens for the absence of words; piped text is still taken —
    // unless the pipe carries the note's name (`append -`), which is not the addition.
    let addition = await gatherBody({ text, content: opts.content, file: opts.file, dash, edit: quiet ? false : opts.edit, noInput: c.opts.input === false || selector === '-' });
    if (opts.divider) addition = addition ? `---\n\n${addition.trim()}` : '---';
    const note = await c.note(selector);
    if (opts.template) {
      const fromTemplate = await templateBody(c, opts.template, titleOf(note));
      addition = addition?.trim() ? `${fromTemplate.trimEnd()}\n\n${addition.trim()}` : fromTemplate;
    }
    if (addition === null || !addition.trim()) throw new CliError('Nothing to append: give text, --content, --file, --divider, --template, or pipe it in', EXIT.usage);
    const body = insert(note.body, addition.trim(), opts);
    const saved = await save(c, updateBody([note], note.id, body)[0], opts.force);
    c.out.value(describe(saved), () => `Appended to "${titleOf(saved)}"`);
  });

  addBodyOptions(program.command('replace-body').allowUnknownOption().description('replace the whole text of a note').argument('<note>', 'id, title, title prefix, filename, or - for stdin').argument('[text...]', 'the text; - reads stdin')).action(
    async (selector: string, words: string[], opts: BodyOpts) => {
      const c = ctx();
      const note = await c.note(selector);
      const dash = words.includes('-');
      const text = words.filter((w) => w !== '-').join(' ');
      const body = await gatherBody({ text, content: opts.content, file: opts.file, dash, edit: opts.edit, noInput: c.opts.input === false });
      if (body === null) throw new CliError('Nothing to write: give text, --content, --file, or pipe it in', EXIT.usage);
      const saved = await save(c, updateBody([note], note.id, body.replace(/\s+$/, ''))[0], opts.force);
      c.out.value(describe(saved), () => `Replaced the text of "${titleOf(saved)}"`);
    },
  );

  program
    .command('inbox')
    .allowUnknownOption()
    .description('file a quick note in the Inbox note (made if missing), as the quick-note box does')
    .argument('[text...]', 'the text; piped input is used when there is none')
    .action(async (words: string[]) => {
      const c = ctx();
      const text = words.filter((w) => w !== '-').join(' ');
      const body = await gatherBody({ text, dash: words.includes('-'), edit: false, noInput: c.opts.input === false });
      const clean = normalise(body ?? '').trim();
      if (!clean) throw new CliError('Nothing to file: give text or pipe it in', EXIT.usage);
      const id = await (await c.backend()).inbox(clean);
      c.out.value({ id, text: clean }, () => 'Added to Inbox');
    });

  program
    .command('capture')
    .description('show the quick-note box (needs the window)')
    .action(async () => {
      const c = ctx();
      await (await c.backend(true)).captureShow();
    });

  program
    .command('rename')
    .description('give a note an explicit title (pointing every [[link]] at it), or clear it so the first line is the title')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('[title]', 'the new title')
    .option('--clear', 'remove the explicit title')
    .option('--no-links', 'leave the [[links]] to the old title as they are')
    .option('--dry-run', 'show what would change, and change nothing')
    .option('--force', 'rename even while the note is being typed in the window')
    .action(async (selector: string, title: string | undefined, opts: { clear?: boolean; links?: boolean } & PlanOpts) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const note = await c.note(selector, notes);
      if (!opts.clear && !title?.trim()) throw new CliError('Give the new title, or --clear', EXIT.usage);
      if (opts.clear) {
        const saved = await save(c, updateTitle([note], note.id, '')[0], opts.force);
        c.out.value(describe(saved), () => `Renamed to "${titleOf(saved)}"`);
        return;
      }
      await settlePlan(c, planRename(notes, { id: note.id, title: title ?? '', links: opts.links !== false }), opts);
    });

  for (const [name, pinned] of [
    ['pin', true],
    ['unpin', false],
  ] as const) {
    program
      .command(name)
      .description(pinned ? 'pin a note to the top of the list' : 'unpin a note')
      .argument('<note...>', 'id, title, title prefix, filename, or - for stdin')
      .action(async (selectors: string[]) => {
        const c = ctx();
        const notes = await (await c.backend()).notes();
        const done: Note[] = [];
        for (const selector of selectors) {
          const note = await c.note(selector, notes);
          const { pinned: _was, ...rest } = note;
          const next: Note = pinned ? { ...rest, pinned: true } : rest;
          if ((note.pinned === true) !== pinned) await save(c, next, true);
          done.push(next);
        }
        // One document however many notes: a list only when more than one was named.
        c.out.value(done.length === 1 ? describe(done[0]) : done.map((n) => describe(n)), () => done.map((n) => `${pinned ? 'Pinned' : 'Unpinned'} "${titleOf(n)}"`).join('\n'));
      });
  }

  addFilterOptions(
    program
      .command('delete')
      .alias('rm')
      .description('move notes to the trash (they wait a month there)')
      .argument('[note...]', 'ids, titles, or - for stdin; or a filter with --tag and friends')
      .option('--permanent', 'skip the trash: gone for good')
      .option('--force', 'delete even a note being typed in the window'),
  ).action(async (selectors: string[], opts: FilterOpts & { permanent?: boolean; force?: boolean }) => {
    const c = ctx();
    const backend = await c.backend();
    const all = await backend.notes();
    let targets: Note[];
    if (selectors.length > 0) {
      targets = [];
      for (const s of selectors) targets.push(await c.note(s, all));
    } else {
      // --force and --permanent say how to delete, not which: on their own they must not mean "everything".
      if (!hasFilterOpts(opts)) throw new CliError('Say which notes to delete: names, or a filter such as --tag', EXIT.usage);
      targets = (await filteredNotes(c, opts)).kept;
    }
    if (targets.length === 0) throw new CliError('No notes to delete', EXIT.notFound);
    const names = targets.map((n) => `"${titleOf(n)}"`).join(', ');
    const what = opts.permanent ? 'Delete for good' : 'Move to the trash';
    if (!(await c.confirm(`${what}: ${names}?`))) {
      c.out.message('Nothing deleted');
      return;
    }
    for (const note of targets) {
      await backend.remove(note.id, { force: opts.force });
      if (opts.permanent) await backend.trashPurge(note.id);
    }
    c.out.value(
      targets.map((n) => ({ id: n.id, title: titleOf(n) })),
      () => `${opts.permanent ? 'Deleted' : 'Moved to the trash'}: ${names}`,
    );
  });

  program
    .command('open')
    .description('bring up the window at a note (starts Notes if it is not running)')
    .argument('[note]', 'id, title, title prefix, filename, or - for stdin')
    .option('-s, --search <words>', 'open the window with this in the search box')
    .option('-w, --wait', 'wait until the note is closed or another is chosen')
    .action(async (selector: string | undefined, opts: { search?: string; wait?: boolean }) => {
      const c = ctx();
      const app = await c.backend(true);
      const note = selector ? await c.note(selector) : null;
      await app.open({ id: note?.id, search: opts.search });
      if (opts.wait && note && app instanceof AppBackend) await app.waitForClose(note.id);
    });

  program
    .command('show-window')
    .description('bring the Notes window to the front (starts it if needed)')
    .action(async () => {
      const c = ctx();
      await (await c.backend(true)).open({});
    });

  program
    .command('stats')
    .description('words, characters, tasks and links, for one note or all of them')
    .argument('[note]', 'a note; every note when omitted')
    .action(async (selector: string | undefined) => {
      const c = ctx();
      const backend = await c.backend();
      const all = await backend.notes();
      if (selector) {
        const note = await c.note(selector, all);
        const d = describe(note, all);
        const versions = (await backend.historyList(note.id)).length;
        const record = { ...d, versions };
        c.out.value(record, () =>
          [
            `${c.out.bold(titleOf(note))}`,
            `${d.words} words · ${d.chars} characters · ${d.tasksDone}/${d.tasks} tasks done`,
            `${(d.links as string[]).length} links out · ${d.backlinks} in · ${versions} versions kept`,
            `made ${iso(note.createdAt)} · edited ${iso(note.updatedAt)}`,
          ].join('\n'),
        );
        return;
      }
      const words = all.reduce((sum, n) => sum + wordCount(n.body), 0);
      const tasks = all.reduce((sum, n) => sum + taskProgress(n.body).total, 0);
      const done = all.reduce((sum, n) => sum + taskProgress(n.body).done, 0);
      const tags = new Set(all.flatMap((n) => tagsOf(n.body))).size;
      const pinned = all.filter((n) => n.pinned).length;
      const record = { notes: all.length, pinned, words, tasks, tasksDone: done, tags };
      c.out.value(record, () => `${all.length} notes (${pinned} pinned) · ${words} words · ${done}/${tasks} tasks done · ${tags} tags`);
    });
}

/** Where an addition goes in a body: the end, the top, or the end of a heading's section. */
export { insert };

export const summary = (note: Note): string => `${titleOf(note)} — ${snippetOf(note, 60)}`;
