// @vitest-environment node
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttachments } from '../core/attachments';
import { createHistory } from '../core/history';
import { pathsFor } from '../core/paths';
import { RPC_ERROR } from '../core/ipc-protocol';
import { createSettings } from '../core/settings';
import { createStore } from '../core/store';

/**
 * The pipe server with Electron stood in for: what a stray client can send
 * before it has said hello must never bring the main process down.
 */

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: () => undefined, handle: () => undefined, removeListener: () => undefined },
}));

const { startIpcServer } = await import('./ipc-server');

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-ipc-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('ipc server', () => {
  it('answers a JSON line that is not an object with an error and stays up', async () => {
    const server = await startIpcServer({
      userData: root,
      version: '0.0.0',
      store: createStore(root),
      history: createHistory(root),
      settings: createSettings(root),
      attachments: createAttachments(root),
      window: () => null,
      applySettings: () => Promise.reject(new Error('not here')),
      showWindow: () => undefined,
      showCapture: () => undefined,
      notify: () => false,
    });
    try {
      const info = JSON.parse(await fs.readFile(pathsFor(root).ipc, 'utf8')) as { token: string };
      const socket = net.connect(server.pipe);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
      const replies: Array<Record<string, unknown>> = [];
      const next = (): Promise<Record<string, unknown>> =>
        new Promise((resolve) => {
          lines.once('line', (line) => {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            replies.push(parsed);
            resolve(parsed);
          });
        });
      socket.write('null\n');
      expect((await next()).error).toMatchObject({ code: RPC_ERROR.invalidRequest });
      socket.write('42\n');
      expect((await next()).error).toMatchObject({ code: RPC_ERROR.invalidRequest });
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { token: info.token } })}\n`);
      expect((await next()).result).toBeTruthy();
      socket.destroy();
    } finally {
      await server.close();
    }
  });
});
