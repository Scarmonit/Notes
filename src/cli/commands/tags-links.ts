import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { graphOf, neighbourhood, relatedNotes, toDot } from '../../core/related';
import { allTags, backlinksOf, linksIn, noteForLink, tagTree, tagsOf, titleOf, updateBody, type TagNode } from '../../renderer/notes';
import type { Note } from '../../shared/types';
import { describe, type Ctx } from '../context';
import { save } from './notes';

/** Tags and links: the two ways notes point at things. */

function flatten(nodes: TagNode[], depth = 0): Array<{ tag: string; label: string; count: number; depth: number }> {
  return nodes.flatMap((n) => [{ tag: n.tag, label: n.label, count: n.count, depth }, ...flatten(n.children, depth + 1)]);
}

/** Adds `#tag` to a body, on its last line if that line is only tags, else as a new line. */
export function addTag(body: string, tag: string): string {
  const clean = tag.replace(/^#/, '').toLowerCase();
  if (tagsOf(body).includes(clean)) return body;
  const lines = body.replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (last.trim() && last.trim().split(/\s+/).every((w) => w.startsWith('#'))) {
    lines[lines.length - 1] = `${last.trimEnd()} #${clean}`;
    return lines.join('\n');
  }
  return body.trim() ? `${body.replace(/\s+$/, '')}\n\n#${clean}` : `#${clean}`;
}

/** Takes every `#tag` (and nothing nested under it) out of a body. */
export function removeTag(body: string, tag: string): string {
  const clean = tag.replace(/^#/, '').toLowerCase();
  const esc = clean.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`(^|(?<=\\s))#${esc}(?![\\p{L}\\p{N}_/-])`, 'giu');
  return body
    .replace(re, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

export function register(program: Command, use: () => Ctx): void {
  const ctx = use;

  program
    .command('tags')
    .description('every tag in use, with how many notes carry it')
    .option('--tree', 'nested tags under their parents')
    .option('--counts', 'show counts in plain output too')
    .action(async (opts: { tree?: boolean; counts?: boolean }) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      if (opts.tree) {
        const rows = flatten(tagTree(notes));
        c.out.rows(rows, [
          { key: 'tag', label: 'tag', format: (_v, row) => `${'  '.repeat(Number(row.depth))}#${String(row.label)}` },
          { key: 'count', label: 'notes', align: 'right', style: 'dim' },
        ]);
        return;
      }
      const rows = allTags(notes);
      if (c.out.mode === 'plain' && !opts.counts && !c.out.fields) {
        for (const r of rows) c.out.write(r.tag);
        return;
      }
      c.out.rows(rows, [
        { key: 'tag', label: 'tag', format: (v) => `#${String(v)}` },
        { key: 'count', label: 'notes', align: 'right', style: 'dim' },
      ]);
    });

  const tag = program.command('tag').description('add or remove a #tag on a note');
  tag
    .command('add')
    .description('write #tag at the end of the note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<tags...>', 'tags, with or without #')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, tags: string[], opts: { force?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      let body = note.body;
      for (const t of tags) body = addTag(body, t);
      const saved = body === note.body ? note : await save(c, updateBody([note], note.id, body)[0], opts.force);
      c.out.value(describe(saved), () => `Tags on "${titleOf(saved)}": ${tagsOf(saved.body).map((t) => `#${t}`).join(' ') || 'none'}`);
    });
  tag
    .command('remove')
    .alias('rm')
    .description('take #tag out of the note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('<tags...>', 'tags, with or without #')
    .option('--force', 'write even while the note is being typed in the window')
    .action(async (selector: string, tags: string[], opts: { force?: boolean }) => {
      const c = ctx();
      const note = await c.note(selector);
      let body = note.body;
      for (const t of tags) body = removeTag(body, t);
      const saved = body === note.body ? note : await save(c, updateBody([note], note.id, body)[0], opts.force);
      c.out.value(describe(saved), () => `Tags on "${titleOf(saved)}": ${tagsOf(saved.body).map((t) => `#${t}`).join(' ') || 'none'}`);
    });

  program
    .command('links')
    .description('the notes a note links to with [[...]]')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--dangling', 'only links that point at no note')
    .action(async (selector: string, opts: { dangling?: boolean }) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const note = await c.note(selector, notes);
      const rows = linksIn(note.body)
        .map((target) => {
          const hit = noteForLink(notes, target);
          return { target, id: hit?.id ?? null, title: hit ? titleOf(hit) : null, exists: hit !== null };
        })
        .filter((r) => !opts.dangling || !r.exists);
      c.out.rows(rows, [
        { key: 'target', label: 'link' },
        { key: 'id', label: 'id', format: (v) => (v ? String(v).slice(0, 8) : '(no note)'), style: 'dim' },
      ]);
    });

  program
    .command('backlinks')
    .description('the notes that link to a note')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .action(async (selector: string) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const note = await c.note(selector, notes);
      const rows = backlinksOf(notes, note.id).map((n: Note) => describe(n, notes));
      c.out.rows(rows, [
        { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
        { key: 'title', label: 'title', style: 'bold' },
      ]);
    });

  program
    .command('related')
    .description('the notes near a note: sharing its tags, or two links away (what the window lists under the backlinks)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('-n, --limit <n>', 'at most n notes', '8')
    .action(async (selector: string, opts: { limit: string }) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      const note = await c.note(selector, notes);
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 0) throw new CliError(`--limit wants a whole number; got "${opts.limit}"`, EXIT.usage);
      const rows = relatedNotes(notes, note.id, limit).map((r) => ({ ...describe(r.note, notes), score: r.score, reasons: r.reasons, why: r.reasons.join(', ') }));
      c.out.rows(rows, [
        { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
        { key: 'title', label: 'title', style: 'bold' },
        { key: 'why', label: 'because', shrink: true, style: 'dim' },
      ]);
    });

  program
    .command('graph')
    .description('the notes as a graph of [[links]]: edges as from/to lines, --json for nodes and edges, --dot for Graphviz')
    .option('--json', 'nodes (id, title, links in and out, tags) and edges')
    .option('--dot', 'Graphviz dot, for `notes graph --dot | dot -Tsvg > notes.svg`')
    .option('--around <note>', 'only the part within --hops links of this note')
    .option('--hops <n>', 'how far from --around to go', '2')
    .action(async (opts: { json?: boolean; dot?: boolean; around?: string; hops: string }) => {
      const c = ctx();
      const notes = await (await c.backend()).notes();
      let graph = graphOf(notes);
      if (opts.around) {
        const hops = Number(opts.hops);
        if (!Number.isInteger(hops) || hops < 0) throw new CliError(`--hops wants a whole number; got "${opts.hops}"`, EXIT.usage);
        graph = neighbourhood(graph, (await c.note(opts.around, notes)).id, hops);
      }
      if (opts.dot) {
        c.out.write(toDot(graph));
        return;
      }
      if (opts.json || c.out.mode === 'json') {
        c.out.write(JSON.stringify(graph, null, 2));
        return;
      }
      const title = new Map(graph.nodes.map((n) => [n.id, n.title]));
      const rows = graph.edges.map((e) => ({ from: title.get(e.from) ?? e.from, to: title.get(e.to) ?? e.to, fromId: e.from, toId: e.to }));
      c.out.rows(rows, [
        { key: 'from', label: 'from', style: 'bold' },
        { key: 'to', label: 'to' },
      ]);
      if (c.out.mode === 'pretty') c.out.message(`${graph.nodes.length} notes, ${graph.edges.length} links`);
    });
}
