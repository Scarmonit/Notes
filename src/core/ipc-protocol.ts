import { createHash } from 'node:crypto';
import type { Snapshot, SnapshotSummary } from '../shared/history';
import type { Settings } from '../shared/settings';
import type { ExternalChanges, Note, SettingsResult, TrashedNote } from '../shared/types';

/**
 * How the command line talks to a running app: one JSON object per line over
 * a named pipe, in the shape of JSON-RPC 2.0. This file is the whole
 * vocabulary — method names, what each takes and gives back, and the error
 * codes — so the client and the server cannot drift apart, and so a method
 * added on one side is a type error on the other until it is handled.
 */

/** Bumped when a change would confuse an older client or server. */
export const PROTOCOL = 1;

/** What the app writes beside its notes once it is listening. */
export interface IpcInfo {
  pipe: string;
  pid: number;
  token: string;
  version: string;
  protocol: number;
}

/**
 * The pipe's name comes from the userData folder, so two apps on two
 * folders (the real one and a test one) never answer each other's calls.
 */
export function pipeNameFor(userData: string): string {
  const key = createHash('sha256').update(userData.toLowerCase().replace(/[\\/]+$/, '')).digest('hex').slice(0, 8);
  return process.platform === 'win32' ? `\\\\.\\pipe\\notes-${key}-v${PROTOCOL}` : `/tmp/notes-${key}-v${PROTOCOL}.sock`;
}

/** Process exit codes, one meaning each. Scripts can rely on them. */
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  notFound: 3,
  busy: 4,
  noApp: 5,
  appError: 6,
  interrupted: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** JSON-RPC error codes: the standard ones, plus the app's own in the server range. */
export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32000,
  notFound: -32001,
  busy: -32002,
  refused: -32003,
} as const;

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: { exit?: ExitCode; candidates?: Array<{ id: string; title: string }> } & Record<string, unknown>;
}

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: RpcErrorShape;
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** An error the far side sent back, carrying the exit code it wants the command line to use. */
export class IpcError extends Error {
  readonly code: number;
  readonly exit: ExitCode;
  readonly data: RpcErrorShape['data'];
  constructor(shape: RpcErrorShape) {
    super(shape.message);
    this.name = 'IpcError';
    this.code = shape.code;
    this.exit = shape.data?.exit ?? EXIT.appError;
    this.data = shape.data;
  }
  toShape(): RpcErrorShape {
    return { code: this.code, message: this.message, data: { ...this.data, exit: this.exit } };
  }
}

/** One of the app's commands, as the command line lists them. */
export interface CommandInfo {
  id: string;
  label: string;
  group: string;
  chord?: string;
  also?: string[];
  hint?: string;
  /** For toggles: whether the thing is currently on. */
  on?: boolean;
  enabled: boolean;
}

/** Whether a note is on screen and whether it holds words not yet saved. */
export interface NoteStatus {
  open: boolean;
  dirty: boolean;
}

/** The layout and view toggles the window keeps for itself. */
export type UiState = Record<string, boolean | number | string | null>;

/** The app's paths, for `notes path`. */
export interface PathsInfo {
  root: string;
  notes: string;
  trash: string;
  history: string;
  attachments: string;
  settings: string;
}

/**
 * Every method, with what it takes and what it returns. `hello` must come
 * first on a connection; the rest are refused until it has.
 */
export interface Methods {
  hello: { params: { token: string; cliVersion: string; protocol: number }; result: { appVersion: string; protocol: number; pid: number; userData: string } };
  'app.info': { params: Record<string, never>; result: { version: string; protocol: number; pid: number; userData: string } };
  paths: { params: Record<string, never>; result: PathsInfo };

  'note.list': { params: Record<string, never>; result: Note[] };
  'note.get': { params: { id: string }; result: Note | null };
  'note.status': { params: { id: string }; result: NoteStatus };
  /** The filename a live note is stored under, or null while it has never been written. */
  'note.file': { params: { id: string }; result: { path: string | null } };
  /** Creates or replaces a note. Refused with `busy` while the note is being typed in, unless forced. */
  'note.put': { params: { note: Note; force?: boolean }; result: Note };
  'note.remove': { params: { id: string; force?: boolean }; result: { removed: boolean } };
  /** Appends a quick note to the Inbox, exactly as the capture box does. */
  inbox: { params: { text: string }; result: { id: string } };

  'trash.list': { params: Record<string, never>; result: TrashedNote[] };
  'trash.get': { params: { id: string }; result: Note | null };
  'trash.restore': { params: { id: string }; result: Note | null };
  'trash.purge': { params: { id: string }; result: { purged: boolean } };

  'history.list': { params: { id: string }; result: SnapshotSummary[] };
  'history.get': { params: { id: string; at: number }; result: Snapshot | null };
  'history.keep': { params: { id: string }; result: { kept: boolean } };
  'history.restore': { params: { id: string; at: number; force?: boolean }; result: Note };

  /** Image bytes, base64. Resolves to the note-asset URL. */
  attach: { params: { bytes: string; name: string }; result: { url: string } };

  'settings.get': { params: Record<string, never>; result: Settings };
  'settings.set': { params: { settings: Settings }; result: SettingsResult };

  'ui.get': { params: Record<string, never>; result: UiState };
  'ui.set': { params: { key: string; value: boolean | number | string | null }; result: UiState };
  commands: { params: Record<string, never>; result: CommandInfo[] };
  run: { params: { id: string }; result: { ran: boolean } };
  open: { params: { id?: string; search?: string }; result: { opened: boolean } };
  'capture.show': { params: Record<string, never>; result: { shown: boolean } };
  /** Writes a rendered export — the preview on a page — to a path: png, pdf, or a standalone html file. */
  'export.render': { params: { id: string; path: string; kind: 'png' | 'pdf' | 'html' }; result: { path: string } };
  /** The preview's HTML for a body, math rendered and diagrams drawn. */
  'render.html': { params: { body: string }; result: { html: string } };
  /** A Windows notification from the app, as a reminder shows; clicking it opens the note when one is named. */
  notify: { params: { title: string; body: string; noteId?: string }; result: { shown: boolean } };

  /** Start or stop receiving `notes.changed` notifications on this connection. */
  'watch.subscribe': { params: Record<string, never>; result: { subscribed: boolean } };
  'watch.unsubscribe': { params: Record<string, never>; result: { subscribed: boolean } };
}

export type MethodName = keyof Methods;
export type Params<M extends MethodName> = Methods[M]['params'];
export type Result<M extends MethodName> = Methods[M]['result'];

/** Notifications the server sends without being asked. */
export interface Notifications {
  'notes.changed': ExternalChanges;
  'note.closed': { id: string };
}

/** The methods the main process answers itself; everything else it asks the window. */
export const MAIN_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  'hello',
  'app.info',
  'paths',
  'note.file',
  'trash.list',
  'trash.get',
  'trash.purge',
  'history.list',
  'history.get',
  'attach',
  'settings.get',
  'settings.set',
  'capture.show',
  'notify',
  'watch.subscribe',
  'watch.unsubscribe',
]);
