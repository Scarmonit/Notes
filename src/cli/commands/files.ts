import type { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../../core/backend';
import { createAttachments } from '../../core/attachments';
import { EXIT, IpcError } from '../../core/ipc-protocol';
import { isTextFile, noteFromFile } from '../../renderer/importer';
import { createNote, exportBody, titleOf, updateBody } from '../../renderer/notes';
import { markdownToText } from '../../renderer/plaintext';
import { absoluteTime } from '../../renderer/time';
import { assetRefs, exportFileName } from '../../shared/assets';
import { exportPage } from '../../shared/export-page';
import type { ExportKind, Note } from '../../shared/types';
import stylesText from '../../renderer/styles.css?inline';
import katexText from '../../renderer/generated/katex.css?inline';
import { addFilterOptions, describe, filteredNotes, hasFilterOpts, type Ctx, type FilterOpts } from '../context';
import { save } from './notes';

/** Files in and out: attachments, import, export. */

/** The markdown for an attached image, the way the editor writes one. */
export const imageMarkdown = (url: string, alt: string): string => `![${alt.replace(/[[\]]/g, '')}](${url})`;

/** Puts lines into a body at a line number (1-based), or at the end. */
export function insertAtLine(body: string, text: string, atLine?: number): string {
  if (atLine === undefined) return body.trimEnd() ? `${body.trimEnd()}\n\n${text}` : text;
  const lines = body.split('\n');
  const at = Math.max(0, Math.min(lines.length, atLine - 1));
  return [...lines.slice(0, at), text, ...lines.slice(at)].join('\n');
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  program
    .command('attach')
    .description('attach images to a note (PNG, JPEG, GIF, WebP, BMP; checked by their bytes)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<files...>', 'image files')
    .option('--alt <text>', 'the alt text (default: the file name)')
    .option('--at-line <n>', 'put the image before line n rather than at the end')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, files: string[], opts: { alt?: string; atLine?: string; force?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const atLine = opts.atLine === undefined ? undefined : Number(opts.atLine);
      if (atLine !== undefined && !Number.isInteger(atLine)) throw new CliError('--at-line wants a line number', EXIT.usage);
      let body = note.body;
      const urls: string[] = [];
      for (const file of files) {
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(file);
        } catch (err) {
          throw new CliError(`Could not read ${file}: ${(err as Error).message}`, EXIT.usage);
        }
        let url: string;
        try {
          url = await backend.attach(new Uint8Array(bytes), path.basename(file));
        } catch (err) {
          if (err instanceof CliError || err instanceof IpcError) throw err;
          throw new CliError(`Could not attach ${file}: ${(err as Error).message}`, EXIT.usage);
        }
        urls.push(url);
        body = insertAtLine(body, imageMarkdown(url, opts.alt ?? path.basename(file, path.extname(file))), atLine === undefined ? undefined : atLine + urls.length - 1);
      }
      const saved = await save(c, updateBody([note], note.id, body)[0], opts.force);
      c.out.value({ ...describe(saved), attached: urls }, () => `Attached ${urls.length === 1 ? 'an image' : `${urls.length} images`} to "${titleOf(saved)}"`);
    });

  program
    .command('attachments')
    .description('the images a note holds, with their files')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .action(async (selector: string) => {
      const c = ctx();
      const backend = await c.backend();
      const note = await c.note(selector);
      const dir = (await backend.paths()).attachments;
      const rows: Array<Record<string, unknown>> = [];
      for (const name of assetRefs(note.body)) {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        rows.push({ name, url: `note-asset://${name}`, path: path.join(dir, name), bytes: stat?.size ?? null, exists: stat !== null });
      }
      c.out.rows(rows, [
        { key: 'name', label: 'file' },
        { key: 'bytes', label: 'bytes', align: 'right', format: (v) => (v === null ? 'missing' : String(v)), style: 'dim' },
        { key: 'path', label: 'path', shrink: true, style: 'dim' },
      ]);
    });

  program
    .command('import')
    .description('make notes from markdown and text files (a leading # heading becomes the title)')
    .argument('<files...>', '.md, .markdown, .txt files')
    .option('--tags <a,b>', 'tags to add to every imported note')
    .action(async (files: string[], opts: { tags?: string }) => {
      const c = ctx();
      const made: Note[] = [];
      for (const file of files) {
        if (!isTextFile(file)) throw new CliError(`${file} is not a markdown or text file`, EXIT.usage);
        let text: string;
        try {
          text = await fs.readFile(file, 'utf8');
        } catch (err) {
          throw new CliError(`Could not read ${file}: ${(err as Error).message}`, EXIT.usage);
        }
        const imported = noteFromFile(path.basename(file), text);
        let body = imported.body;
        if (opts.tags) {
          const tags = opts.tags
            .split(',')
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean)
            .map((t) => `#${t}`)
            .join(' ');
          if (tags) body = body.trim() ? `${body.trimEnd()}\n\n${tags}` : tags;
        }
        const note = createNote(Date.now(), body);
        if (imported.title) note.title = imported.title;
        made.push(await save(c, note));
      }
      c.out.value(
        made.map((n) => describe(n)),
        () => made.map((n) => `${n.id}\t${titleOf(n)}`).join('\n'),
      );
    });

  addFilterOptions(
    program
      .command('export')
      .description('write a note out as Markdown (images alongside), plain text, a self-contained HTML page, a PDF, or a PNG like the preview')
      .argument('[note...]', 'ids, titles, or - for stdin; or a filter, to export several')
      .option('--md', 'Markdown (default)')
      .option('--txt', 'plain text')
      .option('--html', 'one HTML file, styled like the preview, images and math inside it (diagrams need the window)')
      .option('--pdf', 'a PDF on A4 paper (needs the window)')
      .option('--png', 'a PNG rendered like the preview (needs the window)')
      .option('-o, --out <path>', 'the file to write, or a folder when exporting several; - for stdout'),
  ).action(async (selectors: string[], opts: FilterOpts & { md?: boolean; txt?: boolean; html?: boolean; pdf?: boolean; png?: boolean; out?: string }) => {
    const c = ctx();
    const kind: ExportKind = opts.png ? 'png' : opts.pdf ? 'pdf' : opts.html ? 'html' : opts.txt ? 'txt' : 'md';
    const backend = await c.backend(kind === 'png' || kind === 'pdf');
    const all = await backend.notes();
    let targets: Note[];
    if (selectors.length > 0) {
      targets = [];
      for (const s of selectors) targets.push(await c.note(s, all));
    } else {
      targets = hasFilterOpts(opts) ? (await filteredNotes(c, opts)).kept : all;
    }
    if (targets.length === 0) throw new CliError('No notes to export', EXIT.notFound);
    const toStdout = opts.out === '-';
    if (toStdout && (kind === 'png' || kind === 'pdf')) throw new CliError(`A ${kind.toUpperCase()} cannot go to stdout; give a file with -o`, EXIT.usage);
    if (toStdout && targets.length > 1) throw new CliError('Only one note can go to stdout', EXIT.usage);
    const folder = targets.length > 1 || (opts.out && (await fs.stat(opts.out).catch(() => null))?.isDirectory());
    if (!toStdout) {
      // The folder the files go in has to exist before the first write, whether named or implied by the file's path.
      const dir = folder ? (opts.out ?? '.') : path.dirname(opts.out ?? '.');
      await fs.mkdir(dir, { recursive: true }).catch((err) => {
        throw new CliError(`Could not create ${dir}: ${(err as Error).message}`, EXIT.usage);
      });
    }
    const written: string[] = [];
    const attachments = createAttachments(c.userData);
    for (const note of targets) {
      const body = exportBody(note);
      const target = toStdout ? '-' : folder ? path.join(opts.out ?? '.', exportFileName(titleOf(note), kind)) : (opts.out ?? exportFileName(titleOf(note), kind));
      if (kind === 'png' || kind === 'pdf') {
        await backend.exportRendered(note.id, path.resolve(target), kind);
      } else if (kind === 'html') {
        if (backend.mode === 'app' && !toStdout) {
          // The window draws the diagrams; everything else comes out the same either way.
          await backend.exportRendered(note.id, path.resolve(target), 'html');
        } else {
          const html = await attachments.inlineAssets(await backend.renderHtml(body));
          const page = exportPage({ title: titleOf(note), html, css: stylesText, mathCss: katexText, edited: `Edited ${absoluteTime(note.updatedAt)}`, look: 'ink' });
          if (toStdout) c.out.write(page);
          else await fs.writeFile(target, page, 'utf8');
        }
      } else if (kind === 'txt') {
        const text = markdownToText(body);
        if (toStdout) c.out.write(text);
        else await fs.writeFile(target, text, 'utf8');
      } else if (toStdout) {
        c.out.write(body.endsWith('\n') ? body : `${body}\n`);
      } else {
        // In app mode the app's attachments folder is this same folder, so the copy is direct either way.
        await attachments.writeMarkdownExport(target, body);
      }
      if (!toStdout) written.push(path.resolve(target));
    }
    if (!toStdout) c.out.value(written, () => written.join('\n'));
  });
}
