import { BrowserWindow, ipcMain } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import {
  EXIT,
  IpcError,
  MAIN_METHODS,
  PROTOCOL,
  RPC_ERROR,
  pipeNameFor,
  type ExitCode,
  type IpcInfo,
  type MethodName,
  type Notifications,
  type Params,
  type Result,
  type RpcErrorShape,
  type RpcRequest,
  type RpcResponse,
} from '../core/ipc-protocol';
import { pathsFor } from '../core/paths';
import type { Store } from '../core/store';
import type { History } from '../core/history';
import type { Attachments } from '../core/attachments';
import type { SettingsStore } from '../core/settings';
import { IPC } from '../shared/channels';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, SettingsResult } from '../shared/types';

/**
 * The end of the pipe the `notes` command talks to. One JSON object per
 * line, JSON-RPC 2.0; the first must be `hello` with the token this launch
 * wrote to ipc.json. What the main process knows — the trash, the history,
 * the settings, the attachments folder — it answers itself; what only the
 * window knows — the notes as they stand right now, unsaved words included,
 * the layout, the command registry — it asks the window over the ordinary
 * ipcMain channels and relays back.
 *
 * Named pipes go away with the process that made them, so there is no stale
 * socket to clean up, only the ipc.json that points at one.
 */

export interface ServerDeps {
  userData: string;
  version: string;
  store: Store;
  history: History;
  settings: SettingsStore;
  attachments: Attachments;
  /** The notes window, when there is one. */
  window(): BrowserWindow | null;
  /** Stores settings and applies the hotkeys, as the settings sheet does. */
  applySettings(next: Settings): Promise<SettingsResult>;
  showWindow(): void;
  showCapture(): void;
  /** Shows a Windows notification; clicking it opens the note, when one is named. */
  notify(title: string, body: string, noteId?: string): boolean;
}

export interface IpcServer {
  readonly pipe: string;
  /** Tells every connected command that a note left the screen (for --wait). */
  noteClosed(id: string): void;
  /** Asks the window something, the way a command would: for notes:// links. */
  ask<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>>;
  close(): Promise<void>;
}

/** How long the window gets to answer; a PNG render can take a few seconds. */
const WINDOW_REPLY_MS = 60_000;

const errorShape = (code: number, message: string, exit: ExitCode, extra: Record<string, unknown> = {}): RpcErrorShape => ({ code, message, data: { ...extra, exit } });

const exitToCode = (exit: number | undefined): number =>
  exit === EXIT.notFound ? RPC_ERROR.notFound : exit === EXIT.busy ? RPC_ERROR.busy : exit === EXIT.usage ? RPC_ERROR.invalidParams : RPC_ERROR.internal;

export async function startIpcServer(deps: ServerDeps): Promise<IpcServer> {
  const pipe = pipeNameFor(deps.userData);
  const token = randomBytes(32).toString('hex');
  const infoPath = pathsFor(deps.userData).ipc;
  const sockets = new Set<net.Socket>();
  const watching = new Set<net.Socket>();

  // --- asking the window ------------------------------------------------------

  let nextAsk = 1;
  const pendingAsks = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  ipcMain.on(IPC.cliReply, (_event, reply: { id: number; result?: unknown; error?: { message: string; exit?: number; candidates?: unknown } }) => {
    const p = pendingAsks.get(reply.id);
    if (!p) return;
    pendingAsks.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.error) {
      const exit = (reply.error.exit ?? EXIT.appError) as ExitCode;
      p.reject(new IpcError(errorShape(exitToCode(exit), reply.error.message, exit, reply.error.candidates ? { candidates: reply.error.candidates } : {})));
    } else p.resolve(reply.result);
  });

  function askWindow<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    const win = deps.window();
    if (!win || win.isDestroyed()) return Promise.reject(new IpcError(errorShape(RPC_ERROR.internal, 'The Notes window is not open', EXIT.noApp)));
    const id = nextAsk++;
    return new Promise<Result<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAsks.delete(id);
        reject(new IpcError(errorShape(RPC_ERROR.internal, `The window did not answer ${method}`, EXIT.appError)));
      }, WINDOW_REPLY_MS);
      pendingAsks.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      win.webContents.send(IPC.cliRequest, { id, method, params });
    });
  }

  // --- the methods the main process answers itself ------------------------------

  const notFound = (what: string): IpcError => new IpcError(errorShape(RPC_ERROR.notFound, what, EXIT.notFound));

  async function handleMain<M extends MethodName>(method: M, params: Params<M>, socket: net.Socket): Promise<Result<MethodName>> {
    switch (method) {
      case 'app.info':
        return { version: deps.version, protocol: PROTOCOL, pid: process.pid, userData: deps.userData };
      case 'paths': {
        const p = pathsFor(deps.userData);
        return { root: p.root, notes: p.notes, trash: p.trash, history: p.history, attachments: p.attachments, settings: p.settings };
      }
      case 'note.file': {
        const name = deps.store.fileNameOf((params as Params<'note.file'>).id);
        return { path: name ? path.join(deps.store.notesDir, name) : null };
      }
      case 'trash.list':
        return deps.store.listTrash();
      case 'trash.get':
        return deps.store.getTrashed((params as Params<'trash.get'>).id);
      case 'trash.purge': {
        const id = (params as Params<'trash.purge'>).id;
        const purged = await deps.store.purgeTrashed(id);
        if (purged) await deps.history.forgetHistory(id);
        return { purged };
      }
      case 'history.list':
        return deps.history.listHistory((params as Params<'history.list'>).id);
      case 'history.get': {
        const p = params as Params<'history.get'>;
        return deps.history.getSnapshot(p.id, p.at);
      }
      case 'attach': {
        const p = params as Params<'attach'>;
        return { url: await deps.attachments.saveAttachment(new Uint8Array(Buffer.from(p.bytes, 'base64')), p.name) };
      }
      case 'settings.get':
        return deps.settings.settings();
      case 'settings.set':
        return deps.applySettings((params as Params<'settings.set'>).settings);
      case 'capture.show':
        deps.showCapture();
        return { shown: true };
      case 'notify': {
        const p = params as Params<'notify'>;
        return { shown: deps.notify(p.title, p.body, p.noteId) };
      }
      case 'watch.subscribe':
        watching.add(socket);
        return { subscribed: true };
      case 'watch.unsubscribe':
        watching.delete(socket);
        return { subscribed: false };
      default:
        throw notFound(`Unknown method ${String(method)}`);
    }
  }

  async function dispatch(method: MethodName, params: unknown, socket: net.Socket): Promise<unknown> {
    if (MAIN_METHODS.has(method)) return handleMain(method, params as Params<typeof method>, socket);
    // The window's business. Bringing it up first when the call is about showing something.
    if (method === 'open') deps.showWindow();
    return askWindow(method, params as Params<typeof method>);
  }

  // --- the wire --------------------------------------------------------------------

  const send = (socket: net.Socket, message: RpcResponse | { jsonrpc: '2.0'; method: string; params: unknown }): void => {
    if (socket.destroyed || !socket.writable) return;
    socket.write(`${JSON.stringify(message)}\n`);
  };

  const notify = <N extends keyof Notifications>(targets: Iterable<net.Socket>, method: N, params: Notifications[N]): void => {
    for (const s of targets) send(s, { jsonrpc: '2.0', method, params });
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let greeted = false;
    const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let request: RpcRequest;
      try {
        request = JSON.parse(line) as RpcRequest;
      } catch {
        send(socket, { jsonrpc: '2.0', id: 0, error: errorShape(RPC_ERROR.parse, 'Not JSON', EXIT.appError) });
        return;
      }
      if (!request || typeof request !== 'object' || typeof request.id !== 'number' || typeof request.method !== 'string') {
        send(socket, { jsonrpc: '2.0', id: 0, error: errorShape(RPC_ERROR.invalidRequest, 'Not a request', EXIT.appError) });
        return;
      }
      if (!greeted) {
        const p = request.params as Partial<Params<'hello'>> | undefined;
        if (request.method !== 'hello' || p?.token !== token) {
          send(socket, { jsonrpc: '2.0', id: request.id, error: errorShape(RPC_ERROR.unauthorized, 'Say hello first, with the token from ipc.json', EXIT.noApp) });
          socket.end();
          return;
        }
        greeted = true;
        const result: Result<'hello'> = { appVersion: deps.version, protocol: PROTOCOL, pid: process.pid, userData: deps.userData };
        send(socket, { jsonrpc: '2.0', id: request.id, result });
        return;
      }
      void dispatch(request.method as MethodName, request.params, socket).then(
        (result) => send(socket, { jsonrpc: '2.0', id: request.id, result }),
        (err: unknown) => {
          const shape = err instanceof IpcError ? err.toShape() : errorShape(RPC_ERROR.internal, err instanceof Error ? err.message : String(err), EXIT.appError);
          send(socket, { jsonrpc: '2.0', id: request.id, error: shape });
        },
      );
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
      watching.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (err) => console.error('[notes] command pipe failed', err));

  const offChange = deps.store.onChange((changes: ExternalChanges) => notify(watching, 'notes.changed', changes));
  ipcMain.on(IPC.noteClosed, (_event, id: string) => notify(sockets, 'note.closed', { id }));

  const info: IpcInfo = { pipe, pid: process.pid, token, version: deps.version, protocol: PROTOCOL };
  await fs.writeFile(infoPath, JSON.stringify(info), 'utf8');

  return {
    pipe,
    noteClosed: (id) => notify(sockets, 'note.closed', { id }),
    ask: askWindow,
    close: async () => {
      offChange();
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.unlink(infoPath).catch(() => undefined);
    },
  };
}
