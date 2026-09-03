import fs from 'node:fs/promises';
import { CliError } from '../core/backend';
import { EXIT } from '../core/ipc-protocol';
import { editText } from './editor';

/**
 * Where the words of a note come from. Several sources can be given and
 * they concatenate in a fixed order — the text on the command line, then
 * --content, then --file, then whatever is piped in — so `notes new "Title"
 * --file a.md < b.md` is a heading followed by both files. With nothing at
 * all and a terminal to talk to, the editor opens.
 */

export interface BodySources {
  /** Text given as an argument. */
  text?: string;
  content?: string;
  file?: string;
  /** `-` given where text would go: read stdin even at a terminal. */
  dash?: boolean;
  /** Open $EDITOR, with whatever the other sources gave as the starting text. */
  edit?: boolean;
  /** Never read stdin and never open an editor: a script is driving. */
  noInput?: boolean;
}

/** Everything on stdin, or null when stdin is a terminal (a person, who has not typed anything). */
export async function readStdin(force = false): Promise<string | null> {
  if (process.stdin.isTTY && !force) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Windows pipes deliver `\r\n`; notes hold `\n`, the way the paste handler makes them. */
export const normalise = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

let stdinCache: string | null | undefined;

/** Reads stdin once, however many times it is asked for. */
async function stdinOnce(force: boolean): Promise<string | null> {
  if (stdinCache === undefined) stdinCache = await readStdin(force);
  return stdinCache;
}

/**
 * The body from every source given, in order. Returns null when there is
 * nothing at all and no editor could be opened, so the command can decide
 * whether an empty note is what was wanted.
 */
export async function gatherBody(sources: BodySources): Promise<string | null> {
  const parts: string[] = [];
  if (sources.text !== undefined && sources.text !== '') parts.push(normalise(sources.text));
  if (sources.content !== undefined) parts.push(normalise(sources.content));
  if (sources.file !== undefined) {
    try {
      parts.push(normalise(await fs.readFile(sources.file, 'utf8')));
    } catch (err) {
      throw new CliError(`Could not read ${sources.file}: ${(err as Error).message}`, EXIT.usage);
    }
  }
  // Stdin is read when it is asked for with `-`, or when nothing else was
  // given and something is piped in. Never otherwise: a script that gives
  // --content but leaves stdin open must not wait on it.
  if (!sources.noInput && (sources.dash || (parts.length === 0 && !process.stdin.isTTY))) {
    const piped = await stdinOnce(sources.dash === true);
    if (piped !== null && piped !== '') parts.push(normalise(piped));
  }
  let body = parts.join('\n\n');
  const interactive = !sources.noInput && Boolean(process.stdin.isTTY);
  if (sources.edit || (parts.length === 0 && interactive && sources.edit !== false)) {
    if (!interactive) throw new CliError('--edit needs a terminal', EXIT.usage);
    body = (await editText(body)).replace(/\s+$/, '');
  }
  if (parts.length === 0 && !sources.edit && !interactive) return null;
  return body;
}
