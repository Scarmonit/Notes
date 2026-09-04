import type { Readable, Writable } from 'node:stream';
import type { Backend } from '../core/backend';
import { titleOf } from '../renderer/notes';
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

/** One request, answered. Returns null for a notification, which takes no reply. */
export async function handle(deps: ServerDeps, message: Message): Promise<Message | null> {
  const { method, id } = message;
  const notification = id === undefined || id === null;
  const reply = (result: unknown): Message | null => (notification ? null : { jsonrpc: '2.0', id: id as number, result });
  const fail = (code: number, text: string): Message | null => (notification ? null : { jsonrpc: '2.0', id: id as number, error: { code, message: text } });

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
          "These are the user's own notes, kept as markdown files by the Notes app. Search before reading, and read before changing. A note is named by its title, by a title prefix only it has, by an alias it answers to, or by its id. Links between notes are written [[Like this]], tags are #like-this, and a task is `- [ ] like this`, with `@2026-09-10` to schedule it. Deleting moves a note to a trash it can be brought back from for a month.",
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, destructiveHint: t.name === 'delete_note', idempotentHint: t.readOnly, openWorldHint: false },
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
        const text = await tool.run(backend, asObject(params.arguments));
        return reply({ content: [{ type: 'text', text }], isError: false });
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
      let backend: Backend | null = null;
      try {
        backend = await deps.open();
        const notes = await backend.notes();
        return reply({
          resources: notes.map((n) => ({ uri: `notes://${n.id}`, name: titleOf(n), mimeType: 'text/markdown' })),
        });
      } catch (err) {
        return fail(-32603, err instanceof Error ? err.message : String(err));
      } finally {
        await backend?.close().catch(() => undefined);
      }
    }
    case 'resources/read': {
      const uri = String(asObject(message.params).uri ?? '');
      const id = uri.startsWith('notes://') ? uri.slice('notes://'.length) : '';
      let backend: Backend | null = null;
      try {
        backend = await deps.open();
        const note = id ? await backend.get(id) : null;
        if (!note) return fail(-32002, `No note at ${uri}`);
        return reply({ contents: [{ uri, name: titleOf(note), mimeType: 'text/markdown', text: note.body }] });
      } catch (err) {
        return fail(-32603, err instanceof Error ? err.message : String(err));
      } finally {
        await backend?.close().catch(() => undefined);
      }
    }
    case 'prompts/list':
      return reply({ prompts: [] });
    case 'resources/templates/list':
      return reply({ resourceTemplates: [] });
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

    const send = (message: Message): void => {
      output.write(`${JSON.stringify(message)}\n`);
    };

    const take = (text: string): void => {
      let message: Message;
      try {
        message = JSON.parse(text) as Message;
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That was not JSON' } });
        return;
      }
      queue = queue.then(async () => {
        try {
          const answer = await handle(deps, message);
          if (answer) send(answer);
        } catch (err) {
          deps.log(`[notes-mcp] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
          if (message.id !== undefined && message.id !== null) {
            send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
          }
        }
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
