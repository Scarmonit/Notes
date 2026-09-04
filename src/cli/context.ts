import { typeOfValue } from '../shared/properties';
import { confirm as askConfirm, search as askSearch } from '@inquirer/prompts';
import type { Command } from 'commander';
import { CliError, type Backend } from '../core/backend';
import { EXIT } from '../core/ipc-protocol';
import { defaultUserData, userDataDirArg } from '../core/paths';
import { parseDueWindow } from '../core/due';
import { applyFilter, parseSort, parseWhen, parseWords, ROOT_ONLY, SORT_KEYS, type Filter } from '../core/query';
import { resolveNote, resolveTrashed, type Resolution } from '../core/resolve';
import { linksIn, snippetOf, tagsOf, titleOf, wordCount } from '../renderer/notes';
import { taskProgress } from '../renderer/tasks';
import { joinFolder, parseFolder, ROOT_FOLDER } from '../shared/folders';
import { fileNameFor } from '../shared/notes-folder';
import { viewNamed } from '../shared/settings';
import type { Note, TrashedNote } from '../shared/types';
import { readStdin } from './body';
import { connectBackend, type AppPolicy } from './client';
import { iso, Output } from './output';

/** The flags every command shares. */
export interface GlobalOpts {
  json?: boolean;
  plain?: boolean;
  fields?: string;
  color?: boolean;
  quiet?: boolean;
  yes?: boolean;
  input?: boolean;
  app?: boolean;
  userDataDir?: string;
}

export const VERSION: string = typeof __NOTES_VERSION__ === 'string' ? __NOTES_VERSION__ : '0.0.0-dev';

/**
 * What every command has to hand: the output mode, the notes (through the
 * app or the files), and the ways of naming a note. One per invocation.
 */
export class Ctx {
  readonly out: Output;
  readonly opts: GlobalOpts;
  readonly userData: string;
  readonly explicitUserData: boolean;
  readonly version = VERSION;
  /** What the process should exit with when the command ran but has something to say: no match, a chord refused. */
  exitCode = 0;
  private connected: Promise<Backend> | null = null;

  constructor(opts: GlobalOpts, argv: readonly string[] = process.argv, streams?: { out: NodeJS.WritableStream; err: NodeJS.WritableStream; isTTY?: boolean }) {
    this.opts = opts;
    this.out = new Output(
      {
        json: opts.json,
        plain: opts.plain,
        color: opts.color,
        quiet: opts.quiet,
        fields: opts.fields ? opts.fields.split(',').map((f) => f.trim()).filter(Boolean) : undefined,
        isTTY: streams?.isTTY,
      },
      streams?.out,
      streams?.err,
    );
    const explicit = opts.userDataDir ?? userDataDirArg(argv) ?? undefined;
    this.explicitUserData = explicit !== undefined;
    this.userData = explicit ? defaultUserData(['--user-data-dir', explicit], process.env) : defaultUserData([], process.env);
  }

  get appPolicy(): AppPolicy {
    return this.opts.app === false ? 'never' : this.opts.app === true ? 'always' : 'auto';
  }

  /** Whether questions can be asked: a terminal on stdin and nobody said --no-input. */
  interactive(): boolean {
    return Boolean(process.stdin.isTTY) && this.opts.input !== false;
  }

  /** The notes, connected once. `needsApp` starts the app when it is not running. */
  backend(needsApp = false): Promise<Backend> {
    if (!this.connected) {
      this.connected = connectBackend({
        userData: this.userData,
        explicitUserData: this.explicitUserData,
        cliVersion: this.version,
        app: this.appPolicy,
        needsApp,
        log: (text) => this.out.message(text),
      });
    } else if (needsApp) {
      this.connected = this.connected.then(async (b) => {
        if (b.mode === 'app') return b;
        await b.close();
        return connectBackend({
          userData: this.userData,
          explicitUserData: this.explicitUserData,
          cliVersion: this.version,
          app: this.appPolicy,
          needsApp: true,
          log: (text) => this.out.message(text),
        });
      });
    }
    return this.connected;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.connected.then(
      (b) => b.close(),
      () => undefined,
    ).catch(() => undefined);
  }

  /** A selector of `-` means "read it from stdin": the first non-empty line. */
  async selectorText(selector: string): Promise<string> {
    if (selector !== '-') return selector;
    const piped = await readStdin(true);
    const line = (piped ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!line) throw new CliError('Nothing on stdin to name a note with', EXIT.usage);
    // A line from `notes list --plain` starts with the id; take that.
    return line.split('\t')[0];
  }

  /** The note a selector means, or a clear failure: not found, or a choice to make. */
  async note(selector: string, notes?: Note[]): Promise<Note> {
    const text = await this.selectorText(selector);
    const all = notes ?? (await (await this.backend()).notes());
    return this.read(await this.settle(resolveNote(all, text), text, (n) => titleOf(n), 'note'));
  }

  /** When each note named was read, so a save can be refused if the window changed it meanwhile. */
  readonly readAt = new Map<string, number>();

  private read(note: Note): Note {
    this.readAt.set(note.id, note.updatedAt);
    return note;
  }

  async trashed(selector: string, items?: TrashedNote[]): Promise<TrashedNote> {
    const text = await this.selectorText(selector);
    const all = items ?? (await (await this.backend()).trashList());
    return this.settle(resolveTrashed(all, text), text, (n) => n.title, 'deleted note');
  }

  private async settle<T extends { id: string }>(r: Resolution<T>, text: string, name: (n: T) => string, what: string): Promise<T> {
    if (r.kind === 'one') return r.note;
    if (r.kind === 'none') throw new CliError(`No ${what} matches "${text}"`, EXIT.notFound);
    if (this.interactive() && this.out.mode === 'pretty') {
      const chosen = await askSearch<T>({
        message: `Which ${what}?`,
        source: (term) => {
          const q = (term ?? '').toLowerCase();
          return r.candidates.filter((c) => !q || name(c).toLowerCase().includes(q)).map((c) => ({ name: name(c), value: c, description: c.id }));
        },
      });
      return chosen;
    }
    // Folders make two notes called Plan legal, so this is now an everyday
    // answer rather than a mistake, and it gets a code of its own: a script
    // can tell "there is no such note" from "say which one".
    throw new CliError(
      `"${text}" matches ${r.candidates.length} ${what}s; be more specific, use the id, or name the folder it is in`,
      EXIT.ambiguous,
      r.candidates.map((c) => ({ id: c.id, title: name(c), path: 'folder' in c ? joinFolder((c as { folder?: string }).folder ?? ROOT_FOLDER, name(c)) : name(c) })),
    );
  }

  /** An interactive picker over every note, for `edit -i` and friends. */
  async pick(notes: Note[], message = 'Which note?'): Promise<Note> {
    if (!this.interactive()) throw new CliError('Picking a note needs a terminal; name the note instead', EXIT.usage);
    if (notes.length === 0) throw new CliError('There are no notes', EXIT.notFound);
    return this.read(await askSearch<Note>({
      message,
      source: (term) => {
        const q = (term ?? '').toLowerCase();
        return notes
          .filter((n) => !q || titleOf(n).toLowerCase().includes(q) || tagsOf(n.body).some((t) => t.includes(q)))
          .slice(0, 30)
          .map((n) => ({ name: titleOf(n), value: n, description: snippetOf(n, 60) }));
      },
    }));
  }

  /**
   * A yes-or-no before something irreversible. `--yes` answers for the
   * script; without it, and without a terminal, the answer is a refusal
   * with a hint, never a silent yes.
   */
  async confirm(question: string): Promise<boolean> {
    if (this.opts.yes) return true;
    if (!this.interactive() || this.out.mode !== 'pretty') throw new CliError(`${question} Pass --yes to confirm without asking`, EXIT.usage);
    return askConfirm({ message: question, default: false });
  }
}

// --- notes as records ---------------------------------------------------------

/** A note with what a list or a script wants to know about it worked out. */
export function describe(note: Note, all?: Note[]): Record<string, unknown> {
  const tasks = taskProgress(note.body);
  const row: Record<string, unknown> = {
    id: note.id,
    title: titleOf(note),
    explicitTitle: note.title ?? null,
    // Where it lives, and the file it lives in: `Work/Clients` and
    // `Work/Clients/Hale.md`, both relative to the notes folder.
    folder: note.folder ?? ROOT_FOLDER,
    path: joinFolder(note.folder ?? ROOT_FOLDER, note.file ?? `${fileNameFor(titleOf(note))}.md`),
    pinned: note.pinned === true,
    created: iso(note.createdAt),
    updated: iso(note.updatedAt),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    words: wordCount(note.body),
    chars: note.body.length,
    tags: tagsOf(note.body),
    links: linksIn(note.body),
    tasks: tasks.total,
    tasksDone: tasks.done,
    snippet: snippetOf(note),
    // The front-matter keys the app does not own. Part of a note's public
    // shape, not an editing convenience: a notebook where `status: draft` is
    // invisible to the command line is one where the two disagree.
    properties: (note.properties ?? []).map((p) => ({ key: p.key, occurrence: p.occurrence, type: typeOfValue(p.value, p.complex), value: p.complex ? null : p.value })),
    body: note.body,
  };
  if (all) row.backlinks = all.filter((n) => n.id !== note.id && linksIn(n.body).some((t) => t.trim().toLowerCase() === titleOf(note).trim().toLowerCase())).length;
  return row;
}

// --- the filter grammar as options -----------------------------------------------

export interface FilterOpts {
  tag?: string[];
  folder?: string;
  pinned?: boolean;
  untitled?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  linksTo?: string;
  linkedFrom?: string;
  orphan?: boolean;
  hasTasks?: boolean;
  todo?: boolean;
  done?: boolean;
  due?: string;
  sort?: string;
  reverse?: boolean;
  limit?: string;
  view?: string;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/**
 * Whether any flag that narrows the notes was given, so a command can tell
 * "all of them" from "nothing said". Only the narrowing flags count: --sort
 * and --reverse order a list, and a command's own flags are not filters.
 */
export function hasFilterOpts(opts: FilterOpts): boolean {
  const narrowing: Array<keyof FilterOpts> = ['tag', 'folder', 'pinned', 'untitled', 'createdAfter', 'createdBefore', 'updatedAfter', 'updatedBefore', 'linksTo', 'linkedFrom', 'orphan', 'hasTasks', 'todo', 'done', 'due', 'limit'];
  return narrowing.some((key) => opts[key] !== undefined);
}

/** Adds the shared filter flags to a command that takes a set of notes. */
export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('-t, --tag <tag>', 'only notes carrying #tag (repeatable; nested tags count)', collect)
    .option('-F, --folder <path>', 'only notes in this folder or one beneath it; / for the ones at the root')
    .option('--pinned', 'only pinned notes')
    .option('--no-pinned', 'only unpinned notes')
    .option('--untitled', 'only notes without an explicit title')
    .option('--created-after <when>', 'made after a date, or a span ago such as 7d, 2w, 3h')
    .option('--created-before <when>', 'made before')
    .option('--updated-after <when>', 'edited after')
    .option('--updated-before <when>', 'edited before')
    .option('--links-to <note>', 'notes that link to this note')
    .option('--linked-from <note>', 'notes this note links to')
    .option('--orphan', 'notes with no links in either direction')
    .option('--has-tasks', 'notes with a checklist')
    .option('--todo', 'notes with an unticked task')
    .option('--done', 'notes with a ticked task')
    .option('--due <when>', 'notes with a task due by then: today, tomorrow, week, 7d, overdue, any, or a date')
    .option('--sort <key>', `order: ${SORT_KEYS.join(', ')}; add - to reverse (title-)`)
    .option('-r, --reverse', 'reverse the order')
    .option('-n, --limit <n>', 'at most n notes')
    .option('--view <name>', 'a saved search, by name (see `notes views`)');
}

function when(text: string | undefined, flag: string): number | undefined {
  if (text === undefined) return undefined;
  const t = parseWhen(text);
  if (t === null) throw new CliError(`${flag} wants a date, "today", "yesterday" or a span like 7d; got "${text}"`, EXIT.usage);
  return t;
}

/**
 * The filter the options and the bare words describe. The words may carry
 * the search box's operators — `todo:`, `due:today`, `links:Plan` — so a
 * query that works in the window works here unchanged.
 */
export async function filterFrom(ctx: Ctx, opts: FilterOpts, words: readonly string[] = [], notes?: Note[]): Promise<Filter> {
  // A saved search is words like any other: its query goes in front of what
  // was typed, so `notes list --view Due plans` narrows the view further.
  let asked = words;
  if (opts.view !== undefined) {
    const views = (await (await ctx.backend()).settingsGet()).views;
    const view = viewNamed(views, opts.view);
    if (!view) throw new CliError(`No saved search called "${opts.view}"${views.length > 0 ? `; there is ${views.map((v) => v.name).join(', ')}` : ''}`, EXIT.usage);
    asked = [...splitQuery(view.query), ...words];
  }
  const { errors, ...parsed } = parseWords(asked);
  if (errors.length > 0) throw new CliError(errors[0], EXIT.usage);
  const filter: Filter = parsed;
  for (const tag of opts.tag ?? []) filter.tags.push(tag.replace(/^#/, '').toLowerCase());
  if (opts.folder !== undefined) {
    if (opts.folder === '/') filter.folder = ROOT_ONLY;
    else {
      const parsed = parseFolder(opts.folder);
      if ('error' in parsed) throw new CliError(`--folder: ${parsed.error}`, EXIT.usage);
      if (parsed.folder) filter.folder = parsed.folder;
    }
  }
  if (opts.todo) filter.hasTodo = true;
  if (opts.done) filter.hasDone = true;
  if (opts.due !== undefined) {
    const w = parseDueWindow(opts.due);
    if (!w) throw new CliError(`--due wants today, tomorrow, week, 7d, overdue, any or a date; got "${opts.due}"`, EXIT.usage);
    filter.due = w;
  }
  if (opts.pinned !== undefined) filter.pinned = opts.pinned;
  if (opts.untitled) filter.untitled = true;
  filter.createdAfter = when(opts.createdAfter, '--created-after');
  filter.createdBefore = when(opts.createdBefore, '--created-before');
  filter.updatedAfter = when(opts.updatedAfter, '--updated-after');
  filter.updatedBefore = when(opts.updatedBefore, '--updated-before');
  if (opts.linksTo) filter.linksTo = (await ctx.note(opts.linksTo, notes)).id;
  if (opts.linkedFrom) filter.linkedFrom = (await ctx.note(opts.linkedFrom, notes)).id;
  if (opts.orphan) filter.orphan = true;
  if (opts.hasTasks) filter.hasTasks = true;
  if (opts.sort) {
    const s = parseSort(opts.sort);
    if (!s) throw new CliError(`--sort wants one of ${SORT_KEYS.join(', ')}; got "${opts.sort}"`, EXIT.usage);
    filter.sort = s.sort;
    filter.reverse = s.reverse;
  }
  if (opts.reverse) filter.reverse = !filter.reverse;
  if (opts.limit !== undefined) {
    const n = Number(opts.limit);
    if (!Number.isInteger(n) || n < 0) throw new CliError(`--limit wants a whole number; got "${opts.limit}"`, EXIT.usage);
    filter.limit = n;
  }
  return filter;
}

/** The notes a command's filter keeps. */
/** A saved query back into the argv-shaped words parseWords reads, quotes kept whole. */
export function splitQuery(query: string): string[] {
  return (query.match(/"[^"]*"|\S+/g) ?? []).map((w) => w);
}

export async function filteredNotes(ctx: Ctx, opts: FilterOpts, words: readonly string[] = []): Promise<{ all: Note[]; kept: Note[] }> {
  const all = await (await ctx.backend()).notes();
  const filter = await filterFrom(ctx, opts, words, all);
  return { all, kept: applyFilter(all, filter) };
}
