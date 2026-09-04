import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import type { PropertyChange } from '../shared/properties';
import { CliError, type Backend } from '../core/backend';
import { createFileBackend } from '../core/file-backend';
import {
  EXIT,
  IpcError,
  PROTOCOL,
  RPC_ERROR,
  type IpcInfo,
  type MethodName,
  type Notifications,
  type Params,
  type Result,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
} from '../core/ipc-protocol';
import { pathsFor } from '../core/paths';
import type { ExternalChanges, Note } from '../shared/types';

/**
 * Reaching the notes: through the app when it is running, through the
 * files when it is not, and by starting the app when a command needs it.
 *
 * The running app leaves `ipc.json` beside the notes with its pipe name,
 * its pid and a token for this launch. If the pid is alive the pipe is
 * tried; if not, the file is stale — the app was killed rather than quit —
 * and it is ignored, so a dead app can never make a command hang.
 */

/** How long a freshly started app gets to answer before the command gives up. */
const SPAWN_WAIT_MS = 15_000;
const POLL_MS = 100;

export type AppPolicy = 'auto' | 'never' | 'always';

export interface ConnectOptions {
  userData: string;
  cliVersion: string;
  /** `never` = --no-app, `always` = --app. */
  app: AppPolicy;
  /** The command cannot run in file mode: start the app if it is not running. */
  needsApp?: boolean;
  /** Only for tests: how long to wait for a started app. */
  spawnWaitMs?: number;
  /** Where to say what is happening. */
  log?: (text: string) => void;
}

export function readIpcInfo(userData: string): IpcInfo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(pathsFor(userData).ipc, 'utf8')) as Partial<IpcInfo>;
    if (typeof raw.pipe !== 'string' || typeof raw.pid !== 'number' || typeof raw.token !== 'string') return null;
    return { pipe: raw.pipe, pid: raw.pid, token: raw.token, version: String(raw.version ?? ''), protocol: Number(raw.protocol ?? 0) };
  } catch {
    return null;
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Whether an app is listening for this folder, without connecting. */
export function appRunning(userData: string): IpcInfo | null {
  const info = readIpcInfo(userData);
  return info && processAlive(info.pid) ? info : null;
}

// --- the pipe ---------------------------------------------------------------

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };

class Connection {
  private readonly socket: net.Socket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(method: string, params: unknown) => void>();
  private closed: Error | null = null;
  private readonly lost = new Set<(err: CliError) => void>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line) => this.onLine(line));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('the app closed the connection')));
  }

  static connect(pipe: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(pipe);
      socket.once('connect', () => resolve(new Connection(socket)));
      socket.once('error', reject);
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: RpcResponse | RpcNotification;
    try {
      msg = JSON.parse(line) as RpcResponse | RpcNotification;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if ('id' in msg && typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new IpcError(msg.error));
      else p.resolve(msg.result);
    } else if ('method' in msg) {
      for (const fn of this.listeners) fn(msg.method, msg.params);
    }
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = err;
    const lost = new CliError(`Lost the connection to Notes: ${err.message}`, EXIT.appError);
    for (const p of this.pending.values()) p.reject(lost);
    this.pending.clear();
    for (const fn of this.lost) fn(lost);
    this.lost.clear();
  }

  /**
   * Rejects when the connection goes: for a wait on a notification, which
   * would otherwise sit on a dead socket until the process quietly drained.
   */
  whenLost(): Promise<never> {
    return new Promise((_resolve, reject) => {
      if (this.closed) reject(new CliError(`Not connected to Notes: ${this.closed.message}`, EXIT.appError));
      else this.lost.add(reject);
    });
  }

  call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    if (this.closed) return Promise.reject(new CliError(`Not connected to Notes: ${this.closed.message}`, EXIT.appError));
    const id = this.nextId++;
    const request: RpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise<Result<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.write(`${JSON.stringify(request)}\n`);
    });
  }

  onNotification<N extends keyof Notifications>(fn: (method: N, params: Notifications[N]) => void): () => void {
    const wrapped = fn as (method: string, params: unknown) => void;
    this.listeners.add(wrapped);
    return () => this.listeners.delete(wrapped);
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

// --- the app as a backend -----------------------------------------------------

export class AppBackend implements Backend {
  readonly mode = 'app' as const;
  readonly version: string;
  readonly pid: number;
  readonly protocol: number;
  private readonly conn: Connection;

  private constructor(conn: Connection, hello: Result<'hello'>) {
    this.conn = conn;
    this.version = hello.appVersion;
    this.pid = hello.pid;
    this.protocol = hello.protocol;
  }

  /** Connects and says hello. Rejects when nothing answers, or the answer is not Notes. */
  static async connect(info: IpcInfo, cliVersion: string): Promise<AppBackend> {
    const conn = await Connection.connect(info.pipe);
    try {
      const hello = await conn.call('hello', { token: info.token, cliVersion, protocol: PROTOCOL });
      return new AppBackend(conn, hello);
    } catch (err) {
      conn.close();
      throw err;
    }
  }

  private async call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    try {
      return await this.conn.call(method, params);
    } catch (err) {
      if (err instanceof IpcError && err.code === RPC_ERROR.methodNotFound) {
        throw new CliError(`The running Notes (${this.version}) does not know '${method}'; update it or use --no-app`, EXIT.appError);
      }
      throw err;
    }
  }

  paths = () => this.call('paths', {});
  notes = () => this.call('note.list', {});
  get = (id: string) => this.call('note.get', { id });
  status = (id: string) => this.call('note.status', { id });
  fileOf = (id: string) => this.call('note.file', { id }).then((r) => r.path);
  folderList = () => this.call('folder.list', {}).then((r) => r.folders);
  folderCreate = (folder: string) => this.call('folder.create', { folder }).then((r) => r.folder);
  folderRename = (folder: string, name: string) => this.call('folder.rename', { folder, name }).then((r) => r.folder);
  folderMove = (folder: string, into: string) => this.call('folder.move', { folder, into }).then((r) => r.folder);
  folderDelete = (folder: string) => this.call('folder.delete', { folder }).then(() => undefined);
  noteMove = (id: string, folder: string) => this.call('note.move', { id, folder }).then((r) => r.path);
  noteProperty = (id: string, change: PropertyChange) => this.call('note.property', { id, change }).then((r) => r.properties);
  put = (note: Note, options?: { force?: boolean; expectUpdatedAt?: number }) => this.call('note.put', { note, force: options?.force, expectUpdatedAt: options?.expectUpdatedAt });
  remove = (id: string, options?: { force?: boolean }) => this.call('note.remove', { id, force: options?.force }).then((r) => r.removed);
  inbox = (text: string) => this.call('inbox', { text }).then((r) => r.id);
  applyPlan = (plan: Parameters<Backend['applyPlan']>[0], options?: { force?: boolean }) => this.call('refactor.apply', { plan, force: options?.force });
  trashList = () => this.call('trash.list', {});
  trashGet = (id: string) => this.call('trash.get', { id });
  trashRestore = (id: string) => this.call('trash.restore', { id });
  trashPurge = (id: string) => this.call('trash.purge', { id }).then((r) => r.purged);
  historyList = (id: string) => this.call('history.list', { id });
  historyGet = (id: string, at: number) => this.call('history.get', { id, at });
  historyKeep = (id: string) => this.call('history.keep', { id }).then((r) => r.kept);
  historyRestore = (id: string, at: number, options?: { force?: boolean }) => this.call('history.restore', { id, at, force: options?.force });
  attach = (bytes: Uint8Array, name: string) => this.call('attach', { bytes: Buffer.from(bytes).toString('base64'), name }).then((r) => r.url);
  settingsGet = () => this.call('settings.get', {});
  settingsSet = (next: Parameters<Backend['settingsSet']>[0]) => this.call('settings.set', { settings: next });
  uiGet = () => this.call('ui.get', {});
  uiSet = (key: string, value: boolean | number | string | null) => this.call('ui.set', { key, value });
  commands = () => this.call('commands', {});
  run = (id: string) => this.call('run', { id }).then((r) => r.ran);
  open = (options: { id?: string; search?: string }) => this.call('open', options).then((r) => r.opened);
  captureShow = () => this.call('capture.show', {}).then((r) => r.shown);
  exportRendered = (id: string, target: string, kind: 'png' | 'pdf' | 'html') => this.call('export.render', { id, path: target, kind }).then(() => undefined);
  renderHtml = (body: string) => this.call('render.html', { body }).then((r) => r.html);
  notify = (title: string, body: string, noteId?: string) => this.call('notify', { title, body, noteId }).then((r) => r.shown);

  async watch(onChange: (changes: ExternalChanges) => void, signal: AbortSignal): Promise<void> {
    const off = this.conn.onNotification((method, params) => {
      if (method === 'notes.changed') onChange(params as ExternalChanges);
    });
    await this.call('watch.subscribe', {});
    const aborted = new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
    try {
      await Promise.race([aborted, this.conn.whenLost()]);
    } finally {
      off();
    }
    await this.call('watch.unsubscribe', {}).catch(() => undefined);
  }

  /** Waits for the window to report a note closed or saved, VS Code's --wait. */
  waitForClose(id: string): Promise<void> {
    let off = (): void => undefined;
    const closed = new Promise<void>((resolve) => {
      off = this.conn.onNotification((method, params) => {
        if (method === 'note.closed' && (params as { id: string }).id === id) resolve();
      });
    });
    // The app quitting closes the note as surely as the window does: not an error.
    const gone = this.conn.whenLost().catch(() => undefined);
    return Promise.race([closed, gone]).finally(off);
  }

  async close(): Promise<void> {
    this.conn.close();
  }
}

// --- starting the app ---------------------------------------------------------

/** Whether this process is the app's own binary running as Node, so it can start the app. */
export function canSpawnApp(): boolean {
  return Boolean(process.versions.electron) && process.env.ELECTRON_RUN_AS_NODE === '1';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Starts the app detached and waits for it to listen. The app's own
 * binary is this process's binary; only the environment differs.
 */
export async function spawnApp(userData: string, explicitUserData: boolean, waitMs = SPAWN_WAIT_MS): Promise<IpcInfo> {
  if (!canSpawnApp()) {
    throw new CliError('Notes is not running, and it can only be started from the installed `notes` command (or start it yourself)', EXIT.noApp);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_NO_ATTACH_CONSOLE = '1';
  const args = ['--from-cli'];
  if (explicitUserData) args.push(`--user-data-dir=${userData}`);
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env, windowsHide: false, cwd: path.dirname(process.execPath) });
  child.unref();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const info = appRunning(userData);
    if (info) return info;
  }
  throw new CliError(`Started Notes but it did not answer within ${Math.round(waitMs / 1000)} s`, EXIT.noApp);
}

/**
 * The backend for this command. When the app is running (or must be started)
 * the pipe; otherwise the files. `--no-app` never touches the app and
 * `--app` insists on it.
 */
export async function connectBackend(options: ConnectOptions & { explicitUserData?: boolean }): Promise<Backend> {
  const { userData, cliVersion } = options;
  const tryApp = async (info: IpcInfo): Promise<AppBackend | null> => {
    try {
      return await AppBackend.connect(info, cliVersion);
    } catch (err) {
      if (err instanceof IpcError) throw new CliError(`Notes refused the connection: ${err.message}`, EXIT.noApp);
      return null;
    }
  };
  if (options.app !== 'never') {
    const info = appRunning(userData);
    if (info) {
      const app = await tryApp(info);
      if (app) return app;
      options.log?.('Notes is listed as running but did not answer; working on the files instead');
    }
  }
  if (options.app === 'always' || options.needsApp) {
    if (options.app === 'never') throw new CliError('This command needs the Notes window, which --no-app rules out', EXIT.noApp);
    options.log?.('Starting Notes…');
    const info = await spawnApp(userData, options.explicitUserData === true, options.spawnWaitMs);
    // The app writes ipc.json a moment before it is ready for a call; a first refusal is not final.
    for (let attempt = 0; attempt < 30; attempt++) {
      const app = await tryApp(info);
      if (app) return app;
      await sleep(POLL_MS);
    }
    throw new CliError('Started Notes but could not connect to it', EXIT.noApp);
  }
  return createFileBackend(userData, { version: cliVersion });
}
