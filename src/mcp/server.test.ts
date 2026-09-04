// @vitest-environment node
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { handle, serve, SERVER_NAME, type ServerDeps } from './server';
import { TOOLS } from './tools';
import type { Backend } from '../core/backend';
import { createNote, titleOf, updateBody } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * The server against a Backend held in memory: everything the protocol says,
 * without a pipe, a window or a folder of files.
 */
function fakeBackend(seed: Note[]): { backend: Backend; notes: () => Note[]; closed: () => number } {
  let notes = [...seed];
  let closes = 0;
  const backend = {
    mode: 'file',
    version: 'test',
    notes: async () => [...notes],
    get: async (id: string) => notes.find((n) => n.id === id) ?? null,
    put: async (note: Note) => {
      notes = notes.some((n) => n.id === note.id) ? notes.map((n) => (n.id === note.id ? note : n)) : [note, ...notes];
      return note;
    },
    remove: async (id: string) => {
      const had = notes.some((n) => n.id === id);
      notes = notes.filter((n) => n.id !== id);
      return had;
    },
    inbox: async (text: string) => {
      const inbox = notes.find((n) => titleOf(n) === 'Inbox');
      if (!inbox) {
        const made = { ...createNote(1, text), title: 'Inbox' };
        notes = [made, ...notes];
        return made.id;
      }
      notes = updateBody(notes, inbox.id, `${inbox.body}\n\n${text}`);
      return inbox.id;
    },
    close: async () => {
      closes++;
    },
  } as unknown as Backend;
  return { backend, notes: () => notes, closed: () => closes };
}

const note = (id: string, title: string, body: string): Note => ({ id, title, body, createdAt: 1, updatedAt: 1 });

function deps(backend: Backend): ServerDeps {
  return { open: async () => backend, version: '9.9.9', log: () => undefined };
}

const call = async (d: ServerDeps, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> => {
  const answer = await handle(d, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const result = answer?.result as { content: Array<{ text: string }>; isError: boolean };
  return { text: result.content[0].text, isError: result.isError };
};

describe('the protocol', () => {
  const { backend } = fakeBackend([note('a', 'Plans', 'The kitchen. #home')]);
  const d = deps(backend);

  it('answers initialize with the client’s own revision when it knows it', async () => {
    const r = await handle(d, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    const result = r?.result as { protocolVersion: string; serverInfo: { name: string; version: string } };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo).toMatchObject({ name: SERVER_NAME, version: '9.9.9' });
  });

  it('falls back to its own revision for one it does not know', async () => {
    const r = await handle(d, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('says nothing back to a notification', async () => {
    expect(await handle(d, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('lists every tool with a schema and says which ones only read', async () => {
    const r = await handle(d, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (r?.result as { tools: Array<{ name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.every((t) => typeof t.inputSchema === 'object')).toBe(true);
    expect(tools.find((t) => t.name === 'read_note')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'delete_note')?.annotations.readOnlyHint).toBe(false);
  });

  it('refuses a method it does not have', async () => {
    const r = await handle(d, { jsonrpc: '2.0', id: 3, method: 'nonsense/thing' });
    expect((r?.error as { code: number }).code).toBe(-32601);
  });

  it('lists the notes as resources and reads one', async () => {
    const list = await handle(d, { jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect((list?.result as { resources: Array<{ uri: string }> }).resources[0].uri).toBe('notes://a');
    const read = await handle(d, { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'notes://a' } });
    expect((read?.result as { contents: Array<{ text: string }> }).contents[0].text).toContain('The kitchen');
    const missing = await handle(d, { jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'notes://nope' } });
    expect(missing?.error).toBeDefined();
  });
});

describe('the tools', () => {
  it('searches with the app’s own grammar', async () => {
    const { backend } = fakeBackend([note('a', 'Plans', 'kitchen #home'), note('b', 'Other', 'nothing'), note('c', 'Jobs', '- [ ] paint #home')]);
    const d = deps(backend);
    expect((await call(d, 'search_notes', { query: '#home' })).text).toContain('Plans');
    expect((await call(d, 'search_notes', { query: 'todo:' })).text).toContain('Jobs');
    expect((await call(d, 'search_notes', { query: 'todo:' })).text).not.toContain('Other');
    expect((await call(d, 'search_notes', { query: 'nowhere' })).text).toContain('No notes match');
  });

  it('reads a note with what it is joined to', async () => {
    const { backend } = fakeBackend([note('a', 'Plans', 'See [[Jobs]] #home\n- [x] one\n- [ ] two'), note('b', 'Jobs', 'about [[Plans]]')]);
    const text = (await call(deps(backend), 'read_note', { note: 'plans' })).text;
    expect(text).toContain('# Plans');
    expect(text).toContain('tags: #home');
    expect(text).toContain('links to: Jobs');
    expect(text).toContain('linked from: Jobs');
    expect(text).toContain('tasks: 1/2 done');
  });

  it('makes, changes and deletes a note', async () => {
    const seeded = fakeBackend([]);
    const d = deps(seeded.backend);
    expect((await call(d, 'create_note', { title: 'Shopping', body: '- [ ] milk' })).isError).toBe(false);
    expect(seeded.notes()).toHaveLength(1);
    await call(d, 'update_note', { note: 'Shopping', append: '- [ ] bread' });
    expect(seeded.notes()[0].body).toContain('bread');
    await call(d, 'update_note', { note: 'Shopping', title: 'Groceries' });
    expect(titleOf(seeded.notes()[0])).toBe('Groceries');
    expect((await call(d, 'delete_note', { note: 'Groceries' })).text).toContain('Deleted notes');
    expect(seeded.notes()).toHaveLength(0);
  });

  it('appends under a heading, making it when the note has none', async () => {
    const seeded = fakeBackend([note('a', 'Plans', '# Plans\n\ntext')]);
    await call(deps(seeded.backend), 'update_note', { note: 'Plans', append: 'a line', heading: 'Later' });
    expect(seeded.notes()[0].body).toContain('## Later\n\na line');
  });

  it('says which notes a name could mean rather than guessing', async () => {
    const { backend } = fakeBackend([note('a', 'Plan A', ''), note('b', 'Plan B', '')]);
    const r = await call(deps(backend), 'read_note', { note: 'Plan' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('matches 2 notes');
  });

  it('turns a tool’s refusal into an answer, not a protocol error', async () => {
    const { backend } = fakeBackend([]);
    const r = await call(deps(backend), 'read_note', { note: 'nothing' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No note matches');
  });

  it('lists links, backlinks and unlinked mentions together', async () => {
    const { backend } = fakeBackend([note('a', 'Dog', 'woof'), note('b', 'Walks', 'took [[Dog]] out'), note('c', 'Vet', 'the Dog is due')]);
    const text = (await call(deps(backend), 'list_links', { note: 'Dog' })).text;
    expect(text).toContain('Linked from:\n- Walks');
    expect(text).toContain('Mentioned without a link:\n- Vet');
  });

  it('lists the tags and the scheduled tasks', async () => {
    const { backend } = fakeBackend([note('a', 'A', '#home #home/kitchen\n- [ ] paint @2020-01-01')]);
    const d = deps(backend);
    expect((await call(d, 'list_tags')).text).toContain('#home');
    expect((await call(d, 'list_tasks', { when: 'overdue' })).text).toContain('paint');
    // "today" takes in what is already late, the way the app's own due sheet does.
    expect((await call(d, 'list_tasks', { when: 'today' })).text).toContain('overdue');
    expect((await call(d, 'list_tasks', { when: 'nonsense' })).isError).toBe(true);
  });

  it('files a line in the Inbox, making it when there is none', async () => {
    const seeded = fakeBackend([]);
    await call(deps(seeded.backend), 'add_to_inbox', { text: 'call the bank' });
    expect(titleOf(seeded.notes()[0])).toBe('Inbox');
  });

  it('lets go of the notes after every call', async () => {
    const seeded = fakeBackend([note('a', 'A', 'x')]);
    const d = deps(seeded.backend);
    await call(d, 'list_tags');
    await call(d, 'list_tags');
    expect(seeded.closed()).toBe(2);
  });
});

describe('the stdio transport', () => {
  it('reads a line at a time and answers in order', async () => {
    const { backend } = fakeBackend([note('a', 'Plans', 'x')]);
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...String(chunk).split('\n').filter(Boolean)));
    const done = serve(deps(backend), input, output);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n{"jsonrpc":"2.0","id":2,`);
    input.write(`"method":"tools/list"}\n`);
    input.end();
    await done;
    await new Promise((r) => setTimeout(r, 10));
    const answers = lines.map((l) => JSON.parse(l) as { id: number });
    expect(answers.map((a) => a.id)).toEqual([1, 2]);
  });

  it('answers a line that is not JSON without falling over', async () => {
    const { backend } = fakeBackend([]);
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...String(chunk).split('\n').filter(Boolean)));
    const done = serve(deps(backend), input, output);
    input.write('not json at all\n');
    input.end();
    await done;
    await new Promise((r) => setTimeout(r, 10));
    expect(JSON.parse(lines[0])).toMatchObject({ error: { code: -32700 } });
  });
});
