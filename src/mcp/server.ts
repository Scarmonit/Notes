import type { Readable, Writable } from 'node:stream';
import type { Backend } from '../core/backend';
import { snippetOf, titleOf } from '../renderer/notes';
import { TOOLS, ToolError } from './tools';

/**
 * A Model Context Protocol server for the notebook, spoken over stdin and
 * stdout: newline-delimited JSON-RPC 2.0, which is what MCP's stdio transport
 * is. It is written out here rather than taken from a library because the app
 * ships every byte it depends on, and because the app already has a
 * JSON-RPC vocabulary of its own (core/ipc-protocol.ts) that this one mirrors.
 *
 * Everything it can do, the `notes` command can already do; this only puts
 * those doings behind names and descriptions an assistant can read. The
 * `Backend` decides where the notes are: the running window when there is
 * one, so a note being typed in is never overwritten, and the files when
 * there is not.
 */

export const SERVER_NAME = 'notes';

/** The protocol revisions this server knows how to speak. */
const KNOWN_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = KNOWN_VERSIONS[0];

/** How many notes one page of `resources/list` holds. A notebook can be large; a reply should not be. */
const PAGE = 100;

interface Message {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface ServerDeps {
  /** A connection to the notes, made fresh for each call so the app coming and going is followed. */
  open(): Promise<Backend>;
  version: string;
  /** Where diagnostics go. Never stdout: stdout is the protocol. */
  log(text: string): void;
}

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * Where a cursor points. Cursors are opaque to the client by the spec's word,
 * so the offset is written as text rather than handed over as a number, and
 * one that has been tampered with starts from the beginning rather than
 * throwing: a bad cursor is not worth failing a listing over.
 */
const cursorAt = (params: Record<string, unknown>): number => {
  const raw = params.cursor;
  if (typeof raw !== 'string' || raw === '') return 0;
  const at = Number.parseInt(Buffer.from(raw, 'base64url').toString('utf8'), 10);
  return Number.isSafeInteger(at) && at >= 0 ? at : 0;
};
const cursorFor = (at: number): string => Buffer.from(String(at), 'utf8').toString('base64url');

/** One request, answered. Returns null for a notification, which takes no reply. */
export async function handle(deps: ServerDeps, message: Message): Promise<Message | null> {
  const { method, id } = message;
  const notification = id === undefined || id === null;
  const reply = (result: unknown): Message | null => (notification ? null : { jsonrpc: '2.0', id: id as number, result });
  const fail = (code: number, text: string, data?: unknown): Message | null =>
    notification ? null : { jsonrpc: '2.0', id: id as number, error: { code, message: text, ...(data === undefined ? {} : { data }) } };

  switch (method) {
    case 'initialize': {
      const asked = asObject(message.params).protocolVersion;
      // Answer in the client's own revision when it is one we know, so an
      // older client is not turned away over a number.
      const version = typeof asked === 'string' && KNOWN_VERSIONS.includes(asked) ? asked : LATEST;
      return reply({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: SERVER_NAME, title: 'Notes', version: deps.version },
        instructions:
          "These are the user's own notes, kept as markdown files by the Notes app. Search before reading, and read before changing. A note is named by its title, by a title prefix only it has, by an alias it answers to, or by its id. Links between notes are written [[Like this]], tags are #like-this, and a task is `- [ ] like this`, with `@2026-09-10` to schedule it. Notes are filed in folders — real directories, one per note — which say where a note lives, while #tags say what is true about it; two notes in different folders may share a title, and [[Work/Plan]] is how a link says which one it means. Deleting moves a note to a trash it can be brought back from for a month.",
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      // Twelve tools fit in one page, so no cursor is ever handed back; a client
      // that sends one anyway is answered rather than refused.
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
          annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive, idempotentHint: t.idempotent, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const params = asObject(message.params);
      const name = typeof params.name === 'string' ? params.name : '';
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `No tool called "${name}". Ask for tools/list.`);
      let backend: Backend | null = null;
      try {
        backend = await deps.open();
        const answer = await tool.run(backend, asObject(params.arguments));
        // The words are always sent; the data, when there is any, is sent
        // beside them and also serialised into the words, which is what the
        // spec asks for so a client that reads neither field goes without.
        if (answer.structured === undefined) return reply({ content: [{ type: 'text', text: answer.text }], isError: false });
        return reply({
          content: [{ type: 'text', text: answer.text }, { type: 'text', text: JSON.stringify(answer.structured) }],
          structuredContent: answer.structured,
          isError: false,
        });
      } catch (err) {
        // A tool's own refusal is an answer, not a protocol failure: the
        // assistant is meant to read it and try something else.
        const text = err instanceof Error ? err.message : String(err);
        if (!(err instanceof ToolError)) deps.log(`[notes-mcp] ${name} failed: ${text}`);
        return reply({ content: [{ type: 'text', text }], isError: true });
      } finally {
        await backend?.close().catch(() => undefined);
      }
    }
    case 'resources/list': {
      const at = cursorAt(asObject(message.params));
      let backend: Backend | null = null;
      try {
        backend = await deps.open();
        const notes = await backend.notes();
        const page = notes.slice(at, at + PAGE);
        const next = at + page.length;
        return reply({
          resources: page.map((n) => ({
            uri: `notes://${encodeURIComponent(n.id)}`,
            name: titleOf(n),
            title: titleOf(n),
            // Where it lives, then what it says: two notes may share a title
            // now, and the folder is what tells them apart in a flat listing.
            description: n.folder ? `${n.folder} — ${snippetOf(n, 100)}` : snippetOf(n, 120),
            mimeType: 'text/markdown',
            size: Buffer.byteLength(n.body, 'utf8'),
            annotations: { audience: ['assistant'], lastModified: new Date(n.updatedAt).toISOString() },
          })),
          ...(next < notes.length ? { nextCursor: cursorFor(next) } : {}),
        });
      } catch (err) {
        return fail(-32603, err instanceof Error ? err.message : String(err));
      } finally {
        await backend?.close().catch(() => undefined);
      }
    }
    case 'resources/read': {
      const uri = String(asObject(message.params).uri ?? '');
      let id = '';
      if (uri.startsWith('notes://')) {
        const raw = uri.slice('notes://'.length);
        try {
          id = decodeURIComponent(raw);
        } catch {
          id = raw;
        }
      }
      let backend: Backend | null = null;
      try {
        backend = await deps.open();
        const note = id ? await backend.get(id) : null;
        if (!note) return fail(-32002, `No note at ${uri}`, { uri });
        return reply({ contents: [{ uri, name: titleOf(note), title: titleOf(note), mimeType: 'text/markdown', text: note.body }] });
      } catch (err) {
        return fail(-32603, err instanceof Error ? err.message : String(err));
      } finally {
        await backend?.close().catch(() => undefined);
      }
    }
    case 'resources/templates/list':
      return reply({
        resourceTemplates: [
          {
            uriTemplate: 'notes://{id}',
            name: 'note',
            title: 'A note by its id',
            description: 'One note as markdown, by the id notes_search and notes_read give back. Titles will not do here; ids will.',
            mimeType: 'text/markdown',
          },
        ],
      });
    case 'prompts/list':
      // Answered, though the `prompts` capability is not declared: a client
      // that asks anyway gets an empty list rather than an error.
      return reply({ prompts: [] });
    default:
      // A result or an error coming back is not ours to answer.
      if (method === undefined) return null;
      return fail(-32601, `This server does not do ${method}`);
  }
}

/**
 * Reads messages off a stream and writes the answers to another, one JSON
 * object per line. Requests are answered in the order they arrive, which
 * keeps a write of a note from overtaking the read that planned it.
 */
export function serve(deps: ServerDeps, input: Readable, output: Writable): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    let queue: Promise<void> = Promise.resolve();

    const send = (message: unknown): void => {
      output.write(`${JSON.stringify(message)}\n`);
    };

    /** One message answered, with anything it throws turned into an error reply. */
    const answer = async (message: Message): Promise<Message | null> => {
      try {
        return await handle(deps, message);
      } catch (err) {
        deps.log(`[notes-mcp] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        if (message.id === undefined || message.id === null) return null;
        return { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } };
      }
    };

    const take = (text: string): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That was not JSON' } });
        return;
      }
      queue = queue.then(async () => {
        // A batch is an array. The 2025-03-26 revision requires them and
        // 2025-06-18 dropped them; this server speaks both, so it takes one
        // either way and answers with an array of only the replies that are
        // owed — an all-notification batch is answered with nothing at all.
        if (Array.isArray(parsed)) {
          if (parsed.length === 0) {
            send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'An empty batch asks for nothing' } });
            return;
          }
          const answers: Message[] = [];
          for (const one of parsed) {
            const a = await answer(asObject(one) as Message);
            if (a) answers.push(a);
          }
          if (answers.length > 0) send(answers);
          return;
        }
        const a = await answer(parsed as Message);
        if (a) send(a);
      });
    };

    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (text) take(text);
      }
    });
    input.on('end', () => void queue.then(resolve));
    input.on('close', () => void queue.then(resolve));
  });
}
