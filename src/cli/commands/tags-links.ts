import type { Command } from 'commander';
import { CliError } from '../../core/backend';
import { EXIT } from '../../core/ipc-protocol';
import { graphOf, neighbourhood, relatedNotes, toDot } from '../../core/related';
import { unlinkedMentions } from '../../core/mentions';
import { planLinkMention } from '../../core/refactor';
import { allTags, backlinksOf, linksIn, noteForLink, tagTree, tagsOf, titleOf, updateAliases, updateBody, type TagNode } from '../../renderer/notes';
import { cleanAliases } from '../../shared/notes-folder';
import { viewNamed, withView } from '../../shared/settings';
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
    .command('alias')
    .description("the other names a note answers to: a [[link]] naming one finds the note, and so does a search")
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .argument('[names...]', 'the names to set, replacing any it had; none prints the ones it has')
    .option('--add', 'keep the names it has and add these')
    .option('--clear', 'take every other name away')
    .action(async (selector: string, names: string[], opts: { add?: boolean; clear?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const notes = await backend.notes();
      const note = await c.note(selector, notes);
      if (!opts.clear && names.length === 0) {
        const rows = (note.aliases ?? []).map((name) => ({ name }));
        c.out.rows(rows, [{ key: 'name', label: 'also known as', style: 'bold' }]);
        if (rows.length === 0) c.out.message(`'${titleOf(note)}' answers to nothing but its title`);
        return;
      }
      // A name split on commas as well as spaces, so the window's own line works here.
      const asked = opts.clear ? [] : cleanAliases([...(opts.add ? (note.aliases ?? []) : []), ...names.flatMap((n) => n.split(','))]);
      const next = updateAliases(notes, note.id, asked).find((n) => n.id === note.id);
      if (!next) throw new CliError('That note is gone', EXIT.notFound);
      await save(c, next);
      c.out.value({ id: next.id, title: titleOf(next), aliases: next.aliases ?? [] }, () =>
        asked.length === 0 ? `'${titleOf(next)}' answers to nothing but its title` : `'${titleOf(next)}' also answers to ${asked.join(', ')}`,
      );
    });

  program
    .command('mentions')
    .description('the notes that say this one\'s name in plain words without linking to it (what the window lists under Related)')
    .argument('<note>', 'id, title, title prefix, filename, or - for stdin')
    .option('--link <note>', 'turn that note\'s first mention into a [[link]] to this one')
    .option('--link-all', 'link the first mention in every note that has one')
    .option('--dry-run', 'say what would change, and change nothing')
    .action(async (selector: string, opts: { link?: string; linkAll?: boolean; dryRun?: boolean }) => {
      const c = ctx();
      const backend = await c.backend();
      const notes = await backend.notes();
      const note = await c.note(selector, notes);
      const found = unlinkedMentions(notes, note.id, 200);
      if (!opts.link && !opts.linkAll) {
        const rows = found.map((m) => ({ id: m.note.id, title: titleOf(m.note), name: m.name, line: m.line + 1, text: m.text }));
        c.out.rows(rows, [
          { key: 'id', label: 'id', format: (v) => String(v).slice(0, 8), style: 'dim' },
          { key: 'title', label: 'title', style: 'bold' },
          { key: 'line', label: 'line', align: 'right', style: 'dim' },
          { key: 'text', label: 'saying', shrink: true, style: 'dim' },
        ]);
        if (rows.length === 0) c.out.message(`Nothing mentions '${titleOf(note)}' without linking to it`);
        return;
      }
      const only = opts.linkAll ? null : await c.note(opts.link ?? '', notes);
      const wanted = only ? found.filter((m) => m.note.id === only.id) : found;
      if (wanted.length === 0) throw new CliError(`No unlinked mention of '${titleOf(note)}' there`, EXIT.notFound);
      for (const m of wanted) {
        // Each in its own Plan, planned against the notes as they now stand:
        // one rewrite moves the offsets of everything after it in that note.
        const fresh = await backend.notes();
        const again = unlinkedMentions(fresh, note.id, 200).find((x) => x.note.id === m.note.id);
        if (!again) continue;
        const planned = planLinkMention(fresh, again.note.id, note.id, again);
        if (!planned.ok) throw new CliError(planned.message, EXIT.usage);
        if (opts.dryRun) {
          c.out.value(planned.plan, () => planned.plan.sentence);
          continue;
        }
        await backend.applyPlan(planned.plan);
        c.out.value({ id: again.note.id, title: titleOf(again.note), linked: again.name }, () => planned.plan.sentence);
      }
    });

  program
    .command('views')
    .description('the saved searches: a name for a query the search box can ask')
    .action(async () => {
      const c = ctx();
      const views = (await (await c.backend()).settingsGet()).views;
      c.out.rows(views.map((v) => ({ ...v })), [
        { key: 'name', label: 'name', style: 'bold' },
        { key: 'query', label: 'search', shrink: true, style: 'dim' },
      ]);
      if (views.length === 0) c.out.message('No saved searches yet: `notes view save Due "due:week todo:"`');
    });

  const view = program.command('view').description('save, use or forget a named search');

  view
    .command('save')
    .description('name a search and keep it')
    .argument('<name>', 'what to call it')
    .argument('<query...>', "the search: the same grammar as the box — todo: due:today tag:wow /regex/")
    .action(async (name: string, query: string[]) => {
      const c = ctx();
      const backend = await c.backend();
      const settings = await backend.settingsGet();
      const next = withView(settings.views, name, query.join(' '));
      if (next.length === settings.views.length && !viewNamed(settings.views, name)) throw new CliError('Give the search a name and something to search for', EXIT.usage);
      await backend.settingsSet({ ...settings, views: next });
      const saved = viewNamed(next, name);
      c.out.value(saved, () => `Saved '${saved?.name}' as ${saved?.query}`);
    });

  view
    .command('rm')
    .alias('forget')
    .description('take a saved search off the list')
    .argument('<name>', 'its name, or a prefix only it starts')
    .action(async (name: string) => {
      const c = ctx();
      const backend = await c.backend();
      const settings = await backend.settingsGet();
      const found = viewNamed(settings.views, name);
      if (!found) throw new CliError(`No saved search called "${name}"`, EXIT.notFound);
      await backend.settingsSet({ ...settings, views: settings.views.filter((v) => v.name !== found.name) });
      c.out.value(found, () => `Forgot '${found.name}'`);
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
