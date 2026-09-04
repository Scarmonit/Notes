import type { Backend } from '../core/backend';
import { dueLabel, dueTasks, inWindow, parseDueWindow } from '../core/due';
import { unlinkedMentions } from '../core/mentions';
import { applyFilter, parseQuery } from '../core/query';
import { resolveNote } from '../core/resolve';
import { insert, planRename } from '../core/refactor';
import { allTags, backlinksOf, createNote, linksIn, noteForLink, snippetOf, sortByEdited, tagsOf, titleOf, updateBody, updateTitle } from '../renderer/notes';
import { taskProgress } from '../renderer/tasks';
import { folderKey, folderMatches, joinFolder, parseFolder, ROOT_FOLDER } from '../shared/folders';
import { fileNameFor } from '../shared/notes-folder';
import type { Note } from '../shared/types';

/**
 * The notebook as a set of tools an assistant can use.
 *
 * Everything here is the same operation the command line performs, through
 * the same `Backend`: when Notes is running the window is still the single
 * writer and a note being typed in is refused, and when it is not the files
 * are read and written directly. Nothing new about notes is decided here —
 * this file only says which of the app's own doings are worth offering, and
 * describes them well enough that they are used correctly.
 *
 * Every name is prefixed `notes_`, because an assistant holds several of
 * these servers at once and `list_tasks` on its own says nothing about whose
 * tasks. Every tool answers with prose an assistant can read and, where the
 * answer is a list, the same answer again as data under `outputSchema`.
 */

/** What a tool answers: words to read, and — where it has one — the same thing as data. */
export interface Answer {
  text: string;
  structured?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Declared only when `run` always returns `structured`: the spec makes it a promise. */
  outputSchema?: Record<string, unknown>;
  readOnly: boolean;
  /** Whether it can take something away that was not put back. */
  destructive: boolean;
  /** Whether asking twice does no more than asking once. */
  idempotent: boolean;
  run(backend: Backend, args: Record<string, unknown>): Promise<Answer>;
}

class ToolError extends Error {}

const str = (args: Record<string, unknown>, key: string, fallback?: string): string => {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new ToolError(`"${key}" is required`);
};
const maybe = (args: Record<string, unknown>, key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
/** A whole number in range, or the fallback. Anything else is a refusal, not a silent guess. */
const num = (args: Record<string, unknown>, key: string, fallback: number, low: number, high: number): number => {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolError(`"${key}" wants a number, not ${JSON.stringify(v)}`);
  const n = Math.trunc(v);
  if (n < low || n > high) throw new ToolError(`"${key}" wants a number from ${low} to ${high}; ${n} is outside that`);
  return n;
};

/** Which note a selector means, said the way the command line says it. */
async function noteFor(backend: Backend, selector: string, notes?: Note[]): Promise<Note> {
  const all = notes ?? (await backend.notes());
  const r = resolveNote(all, selector);
  if (r.kind === 'one') return r.note;
  if (r.kind === 'none') throw new ToolError(`No note matches "${selector}". Use notes_search to find one, or give its exact title or id.`);
  throw new ToolError(`"${selector}" matches ${r.candidates.length} notes: ${r.candidates.map((n) => `${titleOf(n)} (${n.id})`).join('; ')}`);
}

const line = (n: Note): string => `${titleOf(n)} — ${n.id} — edited ${new Date(n.updatedAt).toISOString()}`;
const stub = (n: Note): Record<string, unknown> => ({ id: n.id, title: titleOf(n), updated: new Date(n.updatedAt).toISOString(), ...whereOf(n) });

/** Where a note lives: its folder, and the file it is in, both from the notebook. */
const whereOf = (n: Note): { folder: string; path: string } => ({
  folder: n.folder ?? ROOT_FOLDER,
  path: joinFolder(n.folder ?? ROOT_FOLDER, n.file ?? `${fileNameFor(titleOf(n))}.md`),
});

/** A note as an assistant should read it: what it is called, what it says, and what it is joined to. */
function describeNote(notes: Note[], n: Note): Answer {
  const tags = tagsOf(n.body);
  const links = linksIn(n.body);
  const back = backlinksOf(notes, n.id);
  const tasks = taskProgress(n.body);
  const head = [
    `# ${titleOf(n)}`,
    `id: ${n.id}`,
    n.aliases?.length ? `also known as: ${n.aliases.join(', ')}` : '',
    `folder: ${n.folder ? n.folder : '/'}`,
    `created: ${new Date(n.createdAt).toISOString()}`,
    `updated: ${new Date(n.updatedAt).toISOString()}`,
    tags.length ? `tags: ${tags.map((t) => `#${t}`).join(' ')}` : '',
    links.length ? `links to: ${links.join(', ')}` : '',
    back.length ? `linked from: ${back.map(titleOf).join(', ')}` : '',
    tasks && tasks.total > 0 ? `tasks: ${tasks.done}/${tasks.total} done` : '',
  ].filter(Boolean);
  return {
    text: `${head.join('\n')}\n\n---\n\n${n.body}`,
    structured: {
      id: n.id,
      title: titleOf(n),
      ...whereOf(n),
      aliases: n.aliases ?? [],
      created: new Date(n.createdAt).toISOString(),
      updated: new Date(n.updatedAt).toISOString(),
      tags,
      links_to: links,
      linked_from: back.map(stub),
      tasks: { done: tasks?.done ?? 0, total: tasks?.total ?? 0 },
      body: n.body,
    },
  };
}

const SELECTOR = {
  type: 'string',
  description: 'The note: its exact title, a title prefix only one note has, an alias it answers to, or its id.',
};

/** A note as it appears in a list: enough to choose one, not enough to read it. */
const NOTE_STUB = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    updated: { type: 'string', description: 'ISO 8601.' },
    folder: { type: 'string', description: 'The folder it is filed in, from the notebook root. Empty for the root itself.' },
    path: { type: 'string', description: 'The markdown file it is in, from the notebook root.' },
  },
  required: ['id', 'title', 'updated', 'folder', 'path'],
} as const;

/** The folder a tool is asked to file something in. */
const FOLDER_ARG = {
  type: 'string',
  description: 'The folder to file it in, from the notebook root, such as Work/Clients. It must already exist — make one with notes_create_folder. Empty or absent means the root.',
};

/** An object schema that refuses arguments it did not ask for, so a misspelt one is not swallowed. */
const shape = (properties: Record<string, unknown>, required?: string[]): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
  additionalProperties: false,
});

/**
 * The folder an argument asks for, as it is spelt on disk. A folder that is
 * not there is a refusal rather than a folder made on the way: an assistant
 * mistyping a path should not quietly leave a folder behind.
 */
async function wantedFolder(backend: Backend, typed: string | undefined): Promise<string> {
  const asked = (typed ?? '').trim();
  if (!asked || asked === '/') return ROOT_FOLDER;
  const parsed = parseFolder(asked);
  if ('error' in parsed) throw new ToolError(parsed.error);
  const folders = await backend.folderList();
  const found = folders.find((f) => folderKey(f) === folderKey(parsed.folder));
  if (!found) throw new ToolError(`There is no folder called ${parsed.folder}. The folders are: ${folders.join(', ') || 'none yet'}.`);
  return found;
}

/** What a tool that writes says back: which note it was, and whether the words changed. */
const WROTE = shape({ id: { type: 'string' }, title: { type: 'string' } }, ['id', 'title']);

export const TOOLS: Tool[] = [
  {
    name: 'notes_search',
    title: 'Search notes',
    description:
      "Find notes in the user's Notes app. The query is the same grammar the app's own search box takes: plain words (every one must appear), \"a phrase\", -excluded, #tag, and operators — todo: done: due:today due:week tag:wow folder:Work pinned: untitled: created:>7d updated:<2026-01-01 links:Plan orphan: sort:title limit:20 and /regex/. folder:Work matches that folder and every folder beneath it; folder:/ matches only the notes at the root. An empty query lists everything, most recently edited first. Returns one line per note with its title, id and the start of its words; notes_read gets the whole of one. Long results are cut at `limit`; ask again with `offset` for the rest.",
    inputSchema: shape({
      query: { type: 'string', description: 'Words and operators. Empty for everything.' },
      limit: { type: 'number', description: 'At most this many notes (1–200, default 25).', minimum: 1, maximum: 200 },
      offset: { type: 'number', description: 'Skip this many matches first, to read past a cut-off page (default 0).', minimum: 0 },
    }),
    outputSchema: shape(
      {
        query: { type: 'string' },
        total: { type: 'number', description: 'How many notes matched in all.' },
        count: { type: 'number', description: 'How many are in this answer.' },
        offset: { type: 'number' },
        has_more: { type: 'boolean' },
        next_offset: { type: 'number', description: 'The offset to ask for next. Absent when there is no more.' },
        notes: { type: 'array', items: { ...NOTE_STUB, properties: { ...NOTE_STUB.properties, snippet: { type: 'string' } } } },
      },
      ['query', 'total', 'count', 'offset', 'has_more', 'notes'],
    ),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const query = str(args, 'query', '');
      const limit = num(args, 'limit', 25, 1, 200);
      const offset = num(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
      const matched = applyFilter(sortByEdited(notes), parseQuery(query));
      const found = matched.slice(offset, offset + limit);
      const more = offset + found.length < matched.length;
      const structured = {
        query,
        total: matched.length,
        count: found.length,
        offset,
        has_more: more,
        ...(more ? { next_offset: offset + found.length } : {}),
        notes: found.map((n) => ({ ...stub(n), snippet: snippetOf(n, 120) })),
      };
      if (found.length === 0) {
        const why = offset > 0 && matched.length > 0 ? `Only ${matched.length} notes match ${query ? `"${query}"` : 'that'}; offset ${offset} is past the end.` : `No notes match ${query ? `"${query}"` : 'that'} (${notes.length} notes in all).`;
        return { text: why, structured };
      }
      const tail = more ? `\n\n${matched.length - offset - found.length} more; ask again with offset: ${offset + found.length}.` : '';
      return { text: `${found.length} of ${matched.length} matching notes (${notes.length} in all):\n${found.map((n) => `- ${line(n)}\n  ${snippetOf(n, 120)}`).join('\n')}${tail}`, structured };
    },
  },
  {
    name: 'notes_read',
    title: 'Read a note',
    description: 'One note in full: its markdown, with its tags, its [[links]], the notes that link to it, and its task count.',
    inputSchema: shape({ note: SELECTOR }, ['note']),
    outputSchema: shape(
      {
        id: { type: 'string' },
        title: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string' } },
        created: { type: 'string' },
        updated: { type: 'string' },
        folder: { type: 'string', description: 'The folder it is filed in, from the notebook root. Empty for the root itself.' },
        path: { type: 'string', description: 'The markdown file it is in, from the notebook root.' },
        tags: { type: 'array', items: { type: 'string' } },
        links_to: { type: 'array', items: { type: 'string' }, description: 'The [[names]] it links to, whether or not a note answers to them yet.' },
        linked_from: { type: 'array', items: NOTE_STUB },
        tasks: shape({ done: { type: 'number' }, total: { type: 'number' } }, ['done', 'total']),
        body: { type: 'string', description: 'The markdown, as written.' },
      },
      ['id', 'title', 'created', 'updated', 'folder', 'path', 'tags', 'links_to', 'linked_from', 'tasks', 'body'],
    ),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const notes = await backend.notes();
      return describeNote(notes, await noteFor(backend, str(args, 'note'), notes));
    },
  },
  {
    name: 'notes_create',
    title: 'Create a note',
    description:
      'Starts a note. The body is markdown: #tags anywhere file it, [[Other note]] links to another note by its title, `- [ ] thing` is a task and `- [ ] thing @2026-09-10` is one due that day.',
    inputSchema: shape(
      {
        title: { type: 'string', description: 'The title. Without one the first line of the body stands in.' },
        body: { type: 'string', description: 'The markdown.' },
        folder: FOLDER_ARG,
      },
      ['body'],
    ),
    outputSchema: shape({ id: { type: 'string' }, title: { type: 'string' }, folder: { type: 'string' }, path: { type: 'string' } }, ['id', 'title', 'folder', 'path']),
    readOnly: false,
    destructive: false,
    idempotent: false,
    async run(backend, args) {
      const made = createNote(Date.now(), str(args, 'body'));
      const title = maybe(args, 'title')?.trim();
      if (title) made.title = title;
      const folder = await wantedFolder(backend, maybe(args, 'folder'));
      if (folder) made.folder = folder;
      const saved = await backend.put(made);
      return { text: `Started "${titleOf(saved)}" (${saved.id})${folder ? ` in ${folder}` : ''}.`, structured: { id: saved.id, title: titleOf(saved), ...whereOf({ ...saved, folder }) } };
    },
  },
  {
    name: 'notes_update',
    title: 'Change a note',
    description:
      'Changes a note. Give `body` to replace it whole, or `append` to add a block at the end (under `heading` when one is named, making it if the note has none). `title` renames it; pass `rewrite_links` to point every other note\'s [[links]] at the new name at the same time. A note being typed in the app right now is refused unless `force` is true.',
    inputSchema: shape(
      {
        note: SELECTOR,
        body: { type: 'string', description: 'The whole new markdown. Replaces everything; read the note first.' },
        append: { type: 'string', description: 'Markdown to add at the end instead.' },
        heading: { type: 'string', description: 'With `append`: the heading to add it under.' },
        title: { type: 'string', description: 'A new title.' },
        rewrite_links: { type: 'boolean', description: 'With `title`: rewrite [[links]] to the old title everywhere else too. Default false, which leaves them pointing at a name no note answers to.' },
        force: { type: 'boolean', description: 'Change it even while it is being typed in the window.' },
      },
      ['note'],
    ),
    outputSchema: shape({ id: { type: 'string' }, title: { type: 'string' }, links_rewritten: { type: 'number' } }, ['id', 'title', 'links_rewritten']),
    readOnly: false,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const n = await noteFor(backend, str(args, 'note'), notes);
      const body = maybe(args, 'body');
      const append = maybe(args, 'append');
      const title = maybe(args, 'title');
      const force = args.force === true;
      const alsoLinks = args.rewrite_links === true && title !== undefined;
      if (body === undefined && append === undefined && title === undefined) throw new ToolError('Give body, append or title: nothing was asked for');

      let next = n;
      let touched = false;
      if (body !== undefined) {
        next = updateBody([next], next.id, body)[0];
        touched = true;
      }
      if (append !== undefined) {
        next = updateBody([next], next.id, insert(next.body, append, { heading: maybe(args, 'heading') }))[0];
        touched = true;
      }
      // A plain rename rides the same write; one that drags the links along is
      // a Plan, so every note it rewrites is checked and written together.
      if (title !== undefined && !alsoLinks) {
        next = updateTitle([next], next.id, title)[0];
        touched = true;
      }
      let saved = touched ? await backend.put(next, { force, expectUpdatedAt: n.updatedAt }) : n;
      let rewritten = 0;
      if (alsoLinks) {
        const fresh = await backend.notes();
        const planned = planRename(fresh, { id: n.id, title: title as string, links: true });
        if (!planned.ok) {
          if (planned.code !== 'nothing_to_do') throw new ToolError(planned.message);
        } else {
          await backend.applyPlan(planned.plan, { force });
          rewritten = planned.plan.summary.links ?? 0;
          saved = (await backend.get(n.id)) ?? saved;
        }
      }
      const also = rewritten > 0 ? ` ${rewritten} ${rewritten === 1 ? 'link' : 'links'} elsewhere now point at it.` : '';
      return { text: `Changed "${titleOf(saved)}" (${saved.id}).${also}`, structured: { id: saved.id, title: titleOf(saved), links_rewritten: rewritten } };
    },
  },
  {
    name: 'notes_delete',
    title: 'Delete a note',
    description: 'Moves a note to the app’s trash, where it waits a month and can be put back. Nothing is destroyed.',
    inputSchema: shape({ note: SELECTOR, force: { type: 'boolean', description: 'Delete it even while it is being typed in the window.' } }, ['note']),
    outputSchema: shape({ id: { type: 'string' }, title: { type: 'string' }, trashed: { type: 'boolean' } }, ['id', 'title', 'trashed']),
    readOnly: false,
    destructive: true,
    idempotent: true,
    async run(backend, args) {
      const n = await noteFor(backend, str(args, 'note'));
      const gone = await backend.remove(n.id, { force: args.force === true });
      return {
        text: gone ? `"${titleOf(n)}" is in Deleted notes; it can be put back for a month.` : `"${titleOf(n)}" was already gone.`,
        structured: { id: n.id, title: titleOf(n), trashed: gone },
      };
    },
  },
  {
    name: 'notes_add_to_inbox',
    title: 'File a quick note',
    description: 'Adds a line at the end of the Inbox note, which is where the app files quick notes. Makes the Inbox if there is none.',
    inputSchema: shape({ text: { type: 'string', description: 'The line to file.' } }, ['text']),
    outputSchema: WROTE,
    readOnly: false,
    destructive: false,
    idempotent: false,
    async run(backend, args) {
      const id = await backend.inbox(str(args, 'text'));
      return { text: 'Filed in the Inbox.', structured: { id, title: 'Inbox' } };
    },
  },
  {
    name: 'notes_list_links',
    title: 'What a note is joined to',
    description:
      'Everything joined to one note: the notes it links to, the notes that link to it, and the notes that say its name in plain words without linking it (unlinked mentions).',
    inputSchema: shape({ note: SELECTOR }, ['note']),
    outputSchema: shape(
      {
        id: { type: 'string' },
        title: { type: 'string' },
        links_to: {
          type: 'array',
          items: shape({ name: { type: 'string' }, id: { type: 'string', description: 'Absent when no note answers to that name yet.' }, title: { type: 'string' } }, ['name']),
        },
        linked_from: { type: 'array', items: NOTE_STUB },
        mentions: {
          type: 'array',
          description: 'Notes that say the name without linking it.',
          items: shape({ id: { type: 'string' }, title: { type: 'string' }, line: { type: 'number', description: 'Counted from 1.' }, text: { type: 'string' } }, ['id', 'title', 'line', 'text']),
        },
      },
      ['id', 'title', 'links_to', 'linked_from', 'mentions'],
    ),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const n = await noteFor(backend, str(args, 'note'), notes);
      const to = linksIn(n.body).map((name) => {
        const hit = noteForLink(notes, name);
        return hit ? { name, id: hit.id, title: titleOf(hit) } : { name };
      });
      const back = backlinksOf(notes, n.id);
      const mentions = unlinkedMentions(notes, n.id, 20).map((m) => ({ id: m.note.id, title: titleOf(m.note), line: m.line + 1, text: m.text }));
      const out: string[] = [`"${titleOf(n)}" (${n.id})`];
      out.push(to.length ? `\nLinks to:\n${to.map((t) => `- ${t.id ? `${t.title} (${t.id})` : `${t.name} — no note yet`}`).join('\n')}` : '\nLinks to: nothing');
      out.push(back.length ? `\nLinked from:\n${back.map((b) => `- ${line(b)}`).join('\n')}` : '\nLinked from: nothing');
      if (mentions.length > 0) out.push(`\nMentioned without a link:\n${mentions.map((m) => `- ${m.title} (${m.id}) line ${m.line}: ${m.text}`).join('\n')}`);
      return { text: out.join('\n'), structured: { id: n.id, title: titleOf(n), links_to: to, linked_from: back.map(stub), mentions } };
    },
  },
  {
    name: 'notes_list_tags',
    title: 'The tags in use',
    description: 'Every #tag written in the notes, with how many notes carry it, most used first. Nested tags are written wow/commands.',
    inputSchema: shape({}),
    outputSchema: shape({ tags: { type: 'array', items: shape({ tag: { type: 'string' }, count: { type: 'number' } }, ['tag', 'count']) } }, ['tags']),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend) {
      const tags = allTags(await backend.notes());
      const structured = { tags: tags.map((t) => ({ tag: t.tag, count: t.count })) };
      if (tags.length === 0) return { text: 'No tags yet.', structured };
      return { text: tags.map((t) => `#${t.tag} — ${t.count} ${t.count === 1 ? 'note' : 'notes'}`).join('\n'), structured };
    },
  },
  {
    name: 'notes_list_folders',
    title: 'The folders in the notebook',
    description:
      "Every folder the user's notes are filed in, empty ones included, with how many notes are in each. A folder is a real directory: a note lives in exactly one, and that is what a folder answers — where a note lives, as against the #tags that say what is true about it. The root, where an unfiled note sits, is written as an empty folder.",
    inputSchema: shape({}),
    outputSchema: shape(
      {
        folders: {
          type: 'array',
          items: shape(
            {
              folder: { type: 'string', description: 'The path from the notebook root, such as Work/Clients.' },
              notes: { type: 'number', description: 'Notes filed directly here.' },
              total: { type: 'number', description: 'Notes here and in every folder beneath it.' },
            },
            ['folder', 'notes', 'total'],
          ),
        },
      },
      ['folders'],
    ),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend) {
      const [folders, notes] = await Promise.all([backend.folderList(), backend.notes()]);
      const rows = folders.map((folder) => ({
        folder,
        notes: notes.filter((n) => (n.folder ?? ROOT_FOLDER) === folder).length,
        total: notes.filter((n) => folderMatches(n.folder ?? ROOT_FOLDER, folder)).length,
      }));
      const atRoot = notes.filter((n) => (n.folder ?? ROOT_FOLDER) === ROOT_FOLDER).length;
      const structured = { folders: rows };
      if (rows.length === 0) return { text: `No folders yet; all ${notes.length} notes are at the root.`, structured };
      return {
        text: [`${atRoot} ${atRoot === 1 ? 'note' : 'notes'} at the root.`, ...rows.map((r) => `${r.folder} — ${r.notes} here, ${r.total} counting what is beneath`)].join('\n'),
        structured,
      };
    },
  },
  {
    name: 'notes_create_folder',
    title: 'Make a folder',
    description: 'Makes a folder in the notebook, and every folder above it. A path from the root, such as Work/Clients/Hale. A folder that is already there is left as it is.',
    inputSchema: shape({ folder: { type: 'string', description: 'The path from the notebook root.' } }, ['folder']),
    outputSchema: shape({ folder: { type: 'string' } }, ['folder']),
    readOnly: false,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const parsed = parseFolder(str(args, 'folder'));
      if ('error' in parsed) throw new ToolError(parsed.error);
      if (!parsed.folder) throw new ToolError('Give the folder a name.');
      const made = await backend.folderCreate(parsed.folder);
      return { text: `Made ${made}.`, structured: { folder: made } };
    },
  },
  {
    name: 'notes_move',
    title: 'File a note in a folder',
    description:
      'Moves a note into another folder. Its title, its id, its [[links]] and its history all stay as they are — only where it lives changes. Moving is its own tool rather than a field on notes_update, because a note changing place is not the same event as its words changing.',
    inputSchema: shape({ note: SELECTOR, folder: FOLDER_ARG }, ['note', 'folder']),
    outputSchema: shape({ id: { type: 'string' }, title: { type: 'string' }, folder: { type: 'string' }, path: { type: 'string' } }, ['id', 'title', 'folder', 'path']),
    readOnly: false,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const note = await noteFor(backend, str(args, 'note'));
      const folder = await wantedFolder(backend, maybe(args, 'folder'));
      const path = await backend.noteMove(note.id, folder);
      return { text: `"${titleOf(note)}" is now at ${path}.`, structured: { id: note.id, title: titleOf(note), folder, path } };
    },
  },
  {
    name: 'notes_list_tasks',
    title: 'Scheduled tasks',
    description:
      "The user's `- [ ]` checklist lines that carry an @date, across every note: what is overdue, due today, due this week or later. `when` takes today, tomorrow, week, 7d, overdue, any or a date.",
    inputSchema: shape({ when: { type: 'string', description: 'today, tomorrow, week, 7d, overdue, any, or a date. Default: week.' } }),
    outputSchema: shape(
      {
        when: { type: 'string' },
        count: { type: 'number' },
        tasks: {
          type: 'array',
          items: shape(
            {
              text: { type: 'string' },
              done: { type: 'boolean' },
              due: { type: 'string', description: 'ISO 8601.' },
              due_label: { type: 'string', description: 'How the app words it: "overdue", "today", and so on.' },
              note_id: { type: 'string' },
              note_title: { type: 'string' },
              line: { type: 'number', description: 'Counted from 1.' },
            },
            ['text', 'done', 'due', 'due_label', 'note_id', 'note_title', 'line'],
          ),
        },
      },
      ['when', 'count', 'tasks'],
    ),
    readOnly: true,
    destructive: false,
    idempotent: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const when = str(args, 'when', 'week');
      const window = parseDueWindow(when);
      if (!window) throw new ToolError(`"${when}" is not a span: try today, tomorrow, week, 7d, overdue, any, or a date`);
      const now = Date.now();
      const tasks = dueTasks(notes).filter((t) => inWindow(t, window));
      const structured = {
        when,
        count: tasks.length,
        tasks: tasks.map((t) => ({
          text: t.text,
          done: t.done,
          due: new Date(t.due).toISOString(),
          due_label: dueLabel(t.due, t.hasTime, now),
          note_id: t.noteId,
          note_title: t.noteTitle,
          line: t.line + 1,
        })),
      };
      if (tasks.length === 0) return { text: `Nothing due ${when}.`, structured };
      return {
        text: tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text} — ${dueLabel(t.due, t.hasTime, now)} — in "${t.noteTitle}" (${t.noteId}) line ${t.line + 1}`).join('\n'),
        structured,
      };
    },
  },
];

export { ToolError };
