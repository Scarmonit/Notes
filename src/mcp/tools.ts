import type { Backend } from '../core/backend';
import { dueLabel, dueTasks, inWindow, parseDueWindow } from '../core/due';
import { unlinkedMentions } from '../core/mentions';
import { applyFilter, parseQuery } from '../core/query';
import { resolveNote } from '../core/resolve';
import { insert } from '../core/refactor';
import { allTags, backlinksOf, createNote, linksIn, noteForLink, snippetOf, sortByEdited, tagsOf, titleOf, updateBody, updateTitle } from '../renderer/notes';
import { taskProgress } from '../renderer/tasks';
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
 */

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run(backend: Backend, args: Record<string, unknown>): Promise<string>;
}

class ToolError extends Error {}

const str = (args: Record<string, unknown>, key: string, fallback?: string): string => {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new ToolError(`"${key}" is required`);
};
const maybe = (args: Record<string, unknown>, key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
const num = (args: Record<string, unknown>, key: string, fallback: number): number => {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** Which note a selector means, said the way the command line says it. */
async function noteFor(backend: Backend, selector: string, notes?: Note[]): Promise<Note> {
  const all = notes ?? (await backend.notes());
  const r = resolveNote(all, selector);
  if (r.kind === 'one') return r.note;
  if (r.kind === 'none') throw new ToolError(`No note matches "${selector}". Use search_notes to find one, or its exact title or id.`);
  throw new ToolError(`"${selector}" matches ${r.candidates.length} notes: ${r.candidates.map((n) => `${titleOf(n)} (${n.id})`).join('; ')}`);
}

const line = (n: Note): string => `${titleOf(n)} — ${n.id} — edited ${new Date(n.updatedAt).toISOString()}`;

/** A note as an assistant should read it: what it is called, what it says, and what it is joined to. */
function describeNote(notes: Note[], n: Note): string {
  const tags = tagsOf(n.body);
  const links = linksIn(n.body);
  const back = backlinksOf(notes, n.id).map(titleOf);
  const tasks = taskProgress(n.body);
  const head = [
    `# ${titleOf(n)}`,
    `id: ${n.id}`,
    n.aliases?.length ? `also known as: ${n.aliases.join(', ')}` : '',
    `created: ${new Date(n.createdAt).toISOString()}`,
    `updated: ${new Date(n.updatedAt).toISOString()}`,
    tags.length ? `tags: ${tags.map((t) => `#${t}`).join(' ')}` : '',
    links.length ? `links to: ${links.join(', ')}` : '',
    back.length ? `linked from: ${back.join(', ')}` : '',
    tasks && tasks.total > 0 ? `tasks: ${tasks.done}/${tasks.total} done` : '',
  ].filter(Boolean);
  return `${head.join('\n')}\n\n---\n\n${n.body}`;
}

const SELECTOR = {
  type: 'string',
  description: 'The note: its exact title, a title prefix only one note has, an alias it answers to, or its id.',
};

export const TOOLS: Tool[] = [
  {
    name: 'search_notes',
    title: 'Search notes',
    description:
      "Find notes in the user's Notes app. The query is the same grammar the app's own search box takes: plain words (every one must appear), \"a phrase\", -excluded, #tag, and operators — todo: done: due:today due:week tag:wow pinned: untitled: created:>7d updated:<2026-01-01 links:Plan orphan: sort:title limit:20 and /regex/. An empty query lists everything, most recently edited first. Returns one line per note with its title and id; read_note gets the words.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words and operators. Empty for everything.' },
        limit: { type: 'number', description: 'At most this many notes (default 25).' },
      },
    },
    readOnly: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const query = str(args, 'query', '');
      const filter = parseQuery(query);
      const found = applyFilter(sortByEdited(notes), filter).slice(0, Math.max(1, num(args, 'limit', 25)));
      if (found.length === 0) return `No notes match ${query ? `"${query}"` : 'that'} (${notes.length} notes in all).`;
      return `${found.length} of ${notes.length} notes:\n${found.map((n) => `- ${line(n)}\n  ${snippetOf(n, 120)}`).join('\n')}`;
    },
  },
  {
    name: 'read_note',
    title: 'Read a note',
    description: "One note in full: its markdown, with its tags, its [[links]], the notes that link to it, and its task count.",
    inputSchema: { type: 'object', properties: { note: SELECTOR }, required: ['note'] },
    readOnly: true,
    async run(backend, args) {
      const notes = await backend.notes();
      return describeNote(notes, await noteFor(backend, str(args, 'note'), notes));
    },
  },
  {
    name: 'create_note',
    title: 'Create a note',
    description:
      "Starts a note. The body is markdown: #tags anywhere file it, [[Other note]] links to another note by its title, `- [ ] thing` is a task and `- [ ] thing @2026-09-10` is one due that day.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title. Without one the first line of the body stands in.' },
        body: { type: 'string', description: 'The markdown.' },
      },
      required: ['body'],
    },
    readOnly: false,
    async run(backend, args) {
      const made = createNote(Date.now(), str(args, 'body'));
      const title = maybe(args, 'title')?.trim();
      if (title) made.title = title;
      const saved = await backend.put(made);
      return `Started "${titleOf(saved)}" (${saved.id}).`;
    },
  },
  {
    name: 'update_note',
    title: 'Change a note',
    description:
      "Changes a note. Give `body` to replace it whole, or `append` to add a block at the end (under `heading` when one is named, making it if the note has none). `title` renames it — note that other notes' [[links]] to the old title are NOT rewritten by this; say so if it matters. A note being typed in the app right now is refused unless `force` is true.",
    inputSchema: {
      type: 'object',
      properties: {
        note: SELECTOR,
        body: { type: 'string', description: 'The whole new markdown.' },
        append: { type: 'string', description: 'Markdown to add at the end instead.' },
        heading: { type: 'string', description: 'With `append`: the heading to add it under.' },
        title: { type: 'string', description: 'A new title.' },
        force: { type: 'boolean', description: 'Change it even while it is being typed in the window.' },
      },
      required: ['note'],
    },
    readOnly: false,
    async run(backend, args) {
      const notes = await backend.notes();
      const n = await noteFor(backend, str(args, 'note'), notes);
      const body = maybe(args, 'body');
      const append = maybe(args, 'append');
      const title = maybe(args, 'title');
      if (body === undefined && append === undefined && title === undefined) throw new ToolError('Give body, append or title: nothing was asked for');
      let next = n;
      if (body !== undefined) next = updateBody([next], next.id, body)[0];
      if (append !== undefined) next = updateBody([next], next.id, insert(next.body, append, { heading: maybe(args, 'heading') }))[0];
      if (title !== undefined) next = updateTitle([next], next.id, title)[0];
      const saved = await backend.put(next, { force: args.force === true, expectUpdatedAt: n.updatedAt });
      return `Changed "${titleOf(saved)}" (${saved.id}).`;
    },
  },
  {
    name: 'delete_note',
    title: 'Delete a note',
    description: 'Moves a note to the app’s trash, where it waits a month and can be put back. Nothing is destroyed.',
    inputSchema: {
      type: 'object',
      properties: { note: SELECTOR, force: { type: 'boolean', description: 'Delete it even while it is being typed in the window.' } },
      required: ['note'],
    },
    readOnly: false,
    async run(backend, args) {
      const n = await noteFor(backend, str(args, 'note'));
      const gone = await backend.remove(n.id, { force: args.force === true });
      return gone ? `"${titleOf(n)}" is in Deleted notes; it can be put back for a month.` : `"${titleOf(n)}" was already gone.`;
    },
  },
  {
    name: 'add_to_inbox',
    title: 'File a quick note',
    description: 'Adds a line at the end of the Inbox note, which is where the app files quick notes. Makes the Inbox if there is none.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    readOnly: false,
    async run(backend, args) {
      await backend.inbox(str(args, 'text'));
      return 'Filed in the Inbox.';
    },
  },
  {
    name: 'list_links',
    title: 'What a note is joined to',
    description:
      'Everything joined to one note: the notes it links to, the notes that link to it, and the notes that say its name in plain words without linking it (unlinked mentions).',
    inputSchema: { type: 'object', properties: { note: SELECTOR }, required: ['note'] },
    readOnly: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const n = await noteFor(backend, str(args, 'note'), notes);
      const out: string[] = [`"${titleOf(n)}" (${n.id})`];
      const to = linksIn(n.body).map((t) => {
        const hit = noteForLink(notes, t);
        return hit ? `${titleOf(hit)} (${hit.id})` : `${t} — no note yet`;
      });
      const back = backlinksOf(notes, n.id);
      const mentions = unlinkedMentions(notes, n.id, 20);
      out.push(to.length ? `\nLinks to:\n${to.map((t) => `- ${t}`).join('\n')}` : '\nLinks to: nothing');
      out.push(back.length ? `\nLinked from:\n${back.map((b) => `- ${line(b)}`).join('\n')}` : '\nLinked from: nothing');
      if (mentions.length > 0) {
        out.push(`\nMentioned without a link:\n${mentions.map((m) => `- ${titleOf(m.note)} (${m.note.id}) line ${m.line + 1}: ${m.text}`).join('\n')}`);
      }
      return out.join('\n');
    },
  },
  {
    name: 'list_tags',
    title: 'The tags in use',
    description: 'Every #tag written in the notes, with how many notes carry it, most used first. Nested tags are written wow/commands.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    async run(backend) {
      const tags = allTags(await backend.notes());
      if (tags.length === 0) return 'No tags yet.';
      return tags.map((t) => `#${t.tag} — ${t.count} ${t.count === 1 ? 'note' : 'notes'}`).join('\n');
    },
  },
  {
    name: 'list_tasks',
    title: 'Scheduled tasks',
    description:
      "The user's `- [ ]` checklist lines that carry an @date, across every note: what is overdue, due today, due this week or later. `when` takes today, tomorrow, week, 7d, overdue, any or a date.",
    inputSchema: {
      type: 'object',
      properties: { when: { type: 'string', description: 'today, tomorrow, week, 7d, overdue, any, or a date. Default: week.' } },
    },
    readOnly: true,
    async run(backend, args) {
      const notes = await backend.notes();
      const when = str(args, 'when', 'week');
      const window = parseDueWindow(when);
      if (!window) throw new ToolError(`"${when}" is not a span: try today, tomorrow, week, 7d, overdue, any, or a date`);
      const tasks = dueTasks(notes).filter((t) => inWindow(t, window));
      if (tasks.length === 0) return `Nothing due ${when}.`;
      const now = Date.now();
      return tasks
        .map((t) => `- [${t.done ? 'x' : ' '}] ${t.text} — ${dueLabel(t.due, t.hasTime, now)} — in "${t.noteTitle}" (${t.noteId}) line ${t.line + 1}`)
        .join('\n');
    },
  },
];

export { ToolError };
