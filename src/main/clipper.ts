import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { parseClip, MAX_CLIP } from '../shared/clipper';

/**
 * The web clipper's receiver: a very small HTTP server on the loopback
 * address, open only while Notes is running.
 *
 * A `notes://` link cannot carry an article — a Windows command line runs out
 * at about eight thousand characters — so the bookmarklet posts instead. The
 * port is whatever the machine hands out and the token is fresh each launch,
 * both of which go into the bookmarklet the Layout sheet copies, so a
 * bookmarklet from a previous launch simply stops working rather than
 * quietly writing into the wrong notebook.
 *
 * Nothing but 127.0.0.1 is listened on and nothing without the token is
 * acted on. Any page in the browser can reach a loopback port; the token is
 * what makes this one the writer's own.
 */

export interface Clipper {
  readonly port: number;
  readonly token: string;
  stop(): void;
}

export interface ClipperDeps {
  /** Files the clipped page. Resolves once it is in the notebook. */
  clip(title: string, text: string): Promise<void>;
  log(message: string): void;
}

export function startClipper(deps: ClipperDeps): Promise<Clipper> {
  const token = randomBytes(16).toString('hex');
  const server: Server = createServer((req, res) => {
    // A bookmarklet's fetch is a cross-origin request from whatever page it
    // was run on, so the answer has to say it is allowed.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST' || !(req.url ?? '').startsWith('/clip')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no');
      return;
    }
    let raw = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_CLIP + 4096) {
        over = true;
        res.writeHead(413, { 'Content-Type': 'text/plain' }).end('too long');
        req.destroy();
      }
    });
    req.on('end', () => {
      if (over) return;
      const read = parseClip(raw, token);
      if (!read.ok) {
        res.writeHead(read.status, { 'Content-Type': 'text/plain' }).end(read.message);
        return;
      }
      deps.clip(read.clip.title, read.clip.text).then(
        () => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('clipped'),
        (err: unknown) => {
          deps.log(`[notes] clip failed: ${err instanceof Error ? err.message : String(err)}`);
          res.writeHead(500, { 'Content-Type': 'text/plain' }).end('failed');
        },
      );
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        token,
        stop: () => server.close(),
      });
    });
  });
}
