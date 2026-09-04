// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathsFor } from '../core/paths';
import { Ctx, type GlobalOpts } from './context';
import { buildProgram } from './program';

/**
 * The commands run in-process against a temporary data folder, with the
 * output captured and every exit code checked. No app is ever contacted:
 * every run carries --no-app.
 */

let root: string;
let stdout: string;
let stderr: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-cli-'));
  stdout = '';
  stderr = '';
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function capture(): { out: PassThrough; err: PassThrough } {
  const out = new PassThrough();
  const err = new PassThrough();
  out.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  err.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return { out, err };
}

async function run(...argv: string[]): Promise<number> {
  stdout = '';
  stderr = '';
  const streams = capture();
  const built = buildProgram({
    writeOut: (s) => streams.out.write(s),
    writeErr: (s) => streams.err.write(s),
    makeCtx: (opts: GlobalOpts) => new Ctx({ ...opts, app: false, userDataDir: root, input: false }, [], { out: streams.out, err: streams.err, isTTY: false }),
  });
  const code = await built.run(['--no-app', '--no-input', '--user-data-dir', root, ...argv]);
  await new Promise((r) => setTimeout(r, 5));
  return code;
}

const lines = (): string[] => stdout.split(/\r?\n/).filter(Boolean);

describe('notes (in-process)', () => {
  it('makes, lists, shows and appends to a note, with the exit codes the plan promises', async () => {
    expect(await run('new', 'Shopping', '--content', '- [ ] milk')).toBe(0);
    const id = lines()[0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await run('list', '--plain')).toBe(0);
    expect(lines()[0]).toContain('Shopping');
    expect(await run('show', 'shop', '--body')).toBe(0);
    expect(stdout.trim()).toBe('- [ ] milk');
    expect(await run('append', 'shopping', '- [ ] eggs')).toBe(0);
    expect(await run('show', id.slice(0, 8), '--body')).toBe(0);
    expect(stdout.trim()).toBe('- [ ] milk\n\n- [ ] eggs');
    expect(await run('show', 'nope')).toBe(3);
    expect(stderr).toContain('No note matches');
    expect(await run('bogus')).toBe(2);
    const files = await fs.readdir(pathsFor(root).notes);
    expect(files).toEqual(['Shopping.md']);
  });

  it('prints JSON and honours --fields', async () => {
    await run('new', 'One', '--content', 'hello #tag');
    expect(await run('list', '--json', '--fields', 'title,tags')).toBe(0);
    expect(JSON.parse(stdout)).toEqual([{ title: 'One', tags: ['tag'] }]);
    expect(await run('show', 'one', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ title: 'One', body: 'hello #tag', words: 2 });
  });

  it('files quick notes in the Inbox, making it when it is missing', async () => {
    expect(await run('inbox', 'call the bank')).toBe(0);
    expect(await run('inbox', 'buy stamps')).toBe(0);
    expect(await run('show', 'Inbox', '--body')).toBe(0);
    expect(stdout.trim()).toBe('call the bank\n\nbuy stamps');
  });

  it('lists an ambiguous name and exits 7, which is not "no such note"', async () => {
    await run('new', 'Shop A');
    await run('new', 'Shop B');
    // 7, not 3: folders make two notes of one name an everyday thing, so a
    // script can tell "say which one" from "there is no such note".
    expect(await run('show', 'shop')).toBe(7);
    expect(stderr).toContain('matches 2 notes');
    expect(stderr).toContain('Shop A');
  });

  it('pins, renames, tags, links and deletes', async () => {
    await run('new', 'Target', '--content', 'the target');
    await run('new', 'Source', '--content', 'see [[Target]]');
    expect(await run('links', 'source', '--plain')).toBe(0);
    expect(lines()[0]).toMatch(/^Target\t/);
    expect(await run('backlinks', 'target', '--plain')).toBe(0);
    expect(lines()[0]).toContain('Source');
    expect(await run('pin', 'target')).toBe(0);
    expect(await run('list', '--plain', '--pinned')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('rename', 'target', 'Renamed Target')).toBe(0);
    expect(await run('tag', 'add', 'renamed', 'wow/commands')).toBe(0);
    expect(await run('show', 'renamed', '--tags')).toBe(0);
    expect(stdout.trim()).toBe('wow/commands');
    expect(await run('list', '--plain', '#wow')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('tag', 'remove', 'renamed', 'wow/commands')).toBe(0);
    expect(await run('show', 'renamed', '--body')).toBe(0);
    expect(stdout.trim()).toBe('the target');
    expect(await run('delete', 'source')).toBe(2); // no --yes, no terminal
    expect(await run('delete', 'source', '--yes')).toBe(0);
    expect(await run('trash', 'list', '--plain')).toBe(0);
    expect(lines()[0]).toContain('Source');
    expect(await run('trash', 'restore', 'source')).toBe(0);
    expect(await run('list', '--plain')).toBe(0);
    expect(lines()).toHaveLength(2);
  });

  it('works checklist items, fences, find and replace', async () => {
    await run('new', 'Tasks', '--content', 'intro\n- [ ] one\n- [x] two\nend');
    expect(await run('tasks', 'tasks', '--plain')).toBe(0);
    expect(lines()).toEqual(['1\t[ ]\tone\t\t2', '2\t[x]\ttwo\t\t3']);
    expect(await run('task', 'tasks', '1', '--done')).toBe(0);
    expect(await run('tasks', 'tasks', '--todo', '--plain')).toBe(0);
    expect(lines()).toEqual([]);
    expect(await run('fence', 'tasks', '--lines', '2-3', '--lang', 'md')).toBe(0);
    expect(await run('show', 'tasks', '--body')).toBe(0);
    expect(stdout.trim()).toBe('intro\n```md\n- [x] one\n- [x] two\n```\nend');
    expect(await run('find', 'tasks', 'two', '--plain')).toBe(0);
    expect(lines()[0]).toMatch(/^4:7\t/);
    expect(await run('replace', 'tasks', 'two', 'deux')).toBe(0);
    expect(await run('find', 'tasks', 'two')).toBe(3);
    expect(await run('outline', 'tasks', '--plain')).toBe(0);
  });

  it('keeps, lists, diffs and restores history', async () => {
    await run('new', 'Hist', '--content', 'first');
    expect(await run('history', 'keep', 'hist')).toBe(0);
    await run('replace-body', 'hist', 'second');
    expect(await run('history', 'list', 'hist', '--plain')).toBe(0);
    expect(lines().length).toBeGreaterThanOrEqual(1);
    expect(await run('history', 'diff', 'hist', '--from', '1', '--plain')).toBe(0);
    expect(stdout).toContain('- first');
    expect(stdout).toContain('+ second');
    expect(await run('history', 'restore', 'hist', '--at', '1')).toBe(0);
    expect(await run('show', 'hist', '--body')).toBe(0);
    expect(stdout.trim()).toBe('first');
  });

  it('imports and exports', async () => {
    const file = path.join(root, 'in.md');
    await fs.writeFile(file, '# Imported title\n\nbody text\n', 'utf8');
    expect(await run('import', file)).toBe(0);
    expect(await run('show', 'imported title', '--body')).toBe(0);
    expect(stdout.trim()).toBe('body text');
    const out = path.join(root, 'out.md');
    expect(await run('export', 'imported', '-o', out)).toBe(0);
    expect(await fs.readFile(out, 'utf8')).toBe('# Imported title\n\nbody text');
    expect(await run('export', 'imported', '--txt', '-o', '-')).toBe(0);
    expect(stdout).toContain('Imported title');
    expect(await run('render', 'imported', '--plain')).toBe(0);
    expect(stdout).toContain('<p>body text</p>');
  });

  it('reads and writes settings and reports paths', async () => {
    expect(await run('settings', 'get', 'hotkey')).toBe(0);
    expect(stdout.trim()).toBe('ctrl+alt+n');
    expect(await run('settings', 'set', 'closeToTray', 'true')).toBe(0);
    expect(await run('settings', 'set', 'hotkey', 'not a chord')).toBe(2);
    expect(await run('settings', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ closeToTray: true });
    expect(await run('path', 'trash')).toBe(0);
    expect(stdout.trim()).toBe(pathsFor(root).trash);
    expect(await run('version', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ running: false, protocol: 1 });
  });

  it('refuses window-only commands with exit 5 under --no-app', async () => {
    expect(await run('ui', 'get')).toBe(5);
    expect(await run('commands')).toBe(5);
    expect(await run('open')).toBe(5);
  });

  it('prints help without touching the notes', async () => {
    expect(await run('--help')).toBe(0);
    expect(stdout).toContain('Usage: notes');
    expect(await run('history', '--help')).toBe(0);
    expect(stdout).toContain('restore');
    await expect(fs.readdir(pathsFor(root).notes)).rejects.toThrow();
  });
});

describe('notes 0.13: templates, due tasks, operators, related, graph, html export', () => {
  it('makes notes from templates, filling in the title and the date', async () => {
    expect(await run('new', 'Meeting', '--content', '# {{title}}\n\nOn {{date}} at {{time:HH}}h\n\n#template #meeting')).toBe(0);
    expect(await run('templates', '--plain')).toBe(0);
    expect(lines()[0]).toContain('Meeting');
    expect(await run('new', 'Standup', '--template', 'meet')).toBe(0);
    expect(await run('show', 'standup', '--body')).toBe(0);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(stdout.trim()).toBe(`# Standup\n\nOn ${iso} at ${String(today.getHours()).padStart(2, '0')}h\n\n#meeting`);
    expect(await run('new', '--template', 'nope')).toBe(3);
    expect(stderr).toContain('No template "nope"');
    expect(await run('append', 'standup', '--template', 'meeting', 'extra words')).toBe(0);
    expect(await run('show', 'standup', '--body')).toBe(0);
    expect(stdout).toContain('# Standup\n\nOn');
    expect(stdout.trim().endsWith('extra words')).toBe(true);
    expect(await run('list', '--plain', 'tag:template')).toBe(0);
    expect(lines()).toHaveLength(1);
  });

  it('schedules tasks, lists what is due, and filters by due: and todo:', async () => {
    await run('new', 'Chores', '--content', '- [ ] bins\n- [x] done thing\nplain line');
    expect(await run('task', 'chores', '1', '--due', 'today')).toBe(0);
    expect(stdout.trim()).toMatch(/^- \[ \] bins @\d{4}-\d{2}-\d{2}$/);
    expect(await run('task', 'chores', 'line:3', '--due', 'tomorrow 14:30')).toBe(0);
    expect(stdout.trim()).toMatch(/^- \[ \] plain line @\d{4}-\d{2}-\d{2} 14:30$/);
    expect(await run('task', 'chores', '1', '--due', 'never')).toBe(2);
    expect(await run('tasks', 'chores', '--due', '--plain')).toBe(0);
    expect(lines()).toHaveLength(2);
    expect(await run('due', '--plain')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain('bins');
    expect(await run('due', 'week', '--plain')).toBe(0);
    expect(lines()).toHaveLength(2);
    expect(await run('due', 'someday')).toBe(2);
    expect(await run('list', '--plain', 'due:today')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain('Chores');
    expect(await run('list', '--plain', '--due', 'tomorrow')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('list', '--plain', 'todo:')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('list', '--plain', 'done:', 'sort:title')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('list', '--plain', '/^chor/')).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(await run('list', 'due:whenever')).toBe(2);
    expect(await run('task', 'chores', '3', '--clear-due')).toBe(0);
    expect(stdout.trim()).toBe('- [ ] plain line');
    expect(await run('due', '--notify')).toBe(5);
  });

  it('lists related notes and the link graph', async () => {
    await run('new', 'Plan', '--content', 'the plan #proj');
    await run('new', 'Notes A', '--content', 'see [[Plan]] #proj');
    await run('new', 'Notes B', '--content', 'see [[Plan]]');
    await run('new', 'Lonely', '--content', 'no links');
    expect(await run('related', 'notes a', '--plain')).toBe(0);
    // Plan is linked directly, so it is already on the page and is not listed again.
    expect(lines().map((l) => l.split('\t')[1])).toEqual(['Notes B']);
    expect(await run('graph', '--plain')).toBe(0);
    expect(lines().sort()).toEqual(['Notes A\tPlan', 'Notes B\tPlan']);
    expect(await run('graph', '--json')).toBe(0);
    const g = JSON.parse(stdout) as { nodes: Array<{ title: string; in: number }>; edges: unknown[] };
    expect(g.edges).toHaveLength(2);
    expect(g.nodes.find((n) => n.title === 'Plan')?.in).toBe(2);
    expect(await run('graph', '--dot')).toBe(0);
    expect(stdout).toContain('digraph notes');
    expect(await run('graph', '--around', 'lonely', '--json')).toBe(0);
    expect(JSON.parse(stdout).nodes).toHaveLength(1);
  });

  it('writes a self-contained HTML export with math, and refuses a PDF without the window', async () => {
    await run('new', 'Math', '--content', 'Euler: $e^{i\pi}+1=0$\n\n$$\n\int_0^1 x\,dx\n$$\n\n```mermaid\ngraph TD; A-->B\n```');
    const out = path.join(root, 'math.html');
    expect(await run('export', 'math', '--html', '-o', out)).toBe(0);
    const html = await fs.readFile(out, 'utf8');
    expect(html).toContain('<title>Math</title>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    // The stylesheet with its fonts only exists in the built bundle; e2e.test.ts checks it there.
    expect(html).toContain('class="mermaid" data-diagram');
    expect(await run('export', 'math', '--pdf', '-o', path.join(root, 'math.pdf'))).toBe(5);
    expect(await run('render', 'math', '--plain')).toBe(0);
    expect(stdout).toContain('katex');
    expect(await run('export', 'math', '--txt', '-o', '-')).toBe(0);
    expect(stdout).toContain('$e^{i\pi}+1=0$');
  });

  it('reads and writes the reminders setting', async () => {
    expect(await run('settings', 'get', 'reminders')).toBe(0);
    expect(stdout.trim()).toBe('true');
    expect(await run('settings', 'set', 'reminders', 'off')).toBe(0);
    expect(await run('settings', 'get', 'reminders')).toBe(0);
    expect(stdout.trim()).toBe('false');
  });
});

describe('0.13.1 regressions', () => {
  it('does not take --force or --permanent for a filter, and --force does not stand in for --yes', async () => {
    expect(await run('new', 'One', '--content', 'a')).toBe(0);
    expect(await run('new', 'Two', '--content', 'b')).toBe(0);
    expect(await run('delete', '--force')).toBe(2);
    expect(await run('delete', '--permanent')).toBe(2);
    expect(await run('delete', '--tag', 'nothing', '--force')).toBe(3); // nothing matched
    expect(await run('list', '--plain')).toBe(0);
    expect(lines()).toHaveLength(2);
    // A filter that is a `false` still counts as one.
    expect(await run('delete', '--no-pinned', '--yes')).toBe(0);
    expect(await run('list', '--plain')).toBe(0);
    expect(lines()).toHaveLength(0);
  });

  it('honours string-valued filters on export, such as --limit', async () => {
    expect(await run('new', 'Alpha', '--content', 'a')).toBe(0);
    expect(await run('new', 'Beta', '--content', 'b')).toBe(0);
    const out = path.join(root, 'exp');
    await fs.mkdir(out);
    expect(await run('export', '--limit', '1', '-o', out)).toBe(0);
    expect((await fs.readdir(out)).filter((f) => f.endsWith('.md'))).toHaveLength(1);
  });

  it('keeps a note titled with a leading dot', async () => {
    expect(await run('new', '.env cheatsheet', '--content', 'secrets')).toBe(0);
    expect(await run('list', '--plain')).toBe(0);
    expect(stdout).toContain('.env cheatsheet');
  });
});

describe('0.15: refile, section move, rename with links, tag rename, merge', () => {
  it('refiles a matched line under a heading, making the heading when it is missing', async () => {
    await run('new', 'Inbox', '--content', 'call the bank\n\n- [ ] compare SQLite backup options\n- [ ] ask Sam about packaging');
    await run('new', 'Project', '--content', '# Project\n\n## Ideas\n\n- old idea\n\n## Done\n\n- shipped');
    expect(await run('refile', 'inbox', 'project', '--match', 'sqlite backup', '--under', 'Ideas')).toBe(0);
    expect(stdout.trim()).toBe("Moved 1 line from 'Inbox' to 'Project' under 'Ideas'");
    expect(await run('show', 'project', '--body')).toBe(0);
    expect(stdout.trim()).toBe('# Project\n\n## Ideas\n\n- old idea\n\n- [ ] compare SQLite backup options\n\n## Done\n\n- shipped');
    expect(await run('show', 'inbox', '--body')).toBe(0);
    expect(stdout.trim()).toBe('call the bank\n\n- [ ] ask Sam about packaging');
    expect(await run('refile', 'inbox', 'project', '--lines', '3', '--under', 'Questions')).toBe(0);
    expect(await run('show', 'project', '--body')).toBe(0);
    expect(stdout.trim()).toMatch(/\n\n## Questions\n\n- \[ \] ask Sam about packaging$/);
    expect(await run('refile', 'inbox', 'project', '--match', 'nothing like this')).toBe(3);
    expect(await run('refile', 'inbox', 'project')).toBe(2);
    expect(await run('refile', 'inbox', 'project', '--lines', '99')).toBe(2);
  });

  it('shows a dry run as a table, or the whole Plan as JSON, and writes nothing', async () => {
    await run('new', 'Inbox', '--content', 'one\n\ntwo');
    await run('new', 'Target', '--content', '# T');
    expect(await run('refile', 'inbox', 'target', '--lines', '1', '--top', '--dry-run')).toBe(0);
    expect(stdout).toContain('Inbox');
    expect(stdout).toContain('lines removed');
    expect(await run('refile', 'inbox', 'target', '--lines', '1', '--top', '--dry-run', '--json')).toBe(0);
    const plan = JSON.parse(stdout) as { kind: string; writes: Array<{ id: string; before: { body: string }; after: { body: string } }>; sentence: string };
    expect(plan.kind).toBe('refile');
    expect(plan.writes.map((w) => [w.before.body, w.after.body])).toEqual([
      ['one\n\ntwo', 'two'],
      ['# T', 'one\n\n# T'],
    ]);
    expect(plan.sentence).toBe("Move 1 line from 'Inbox' to the top of 'Target'");
    expect(await run('show', 'inbox', '--body')).toBe(0);
    expect(stdout.trim()).toBe('one\n\ntwo');
  });

  it('moves a section with its subsections, levels untouched', async () => {
    await run('new', 'Journal', '--content', 'intro\n\n# Monday\n\nrain\n\n## Later\n\nsun\n\n# Tuesday\n\nwind');
    await run('new', 'Weather', '--content', '# Weather');
    expect(await run('section', 'move', 'journal', 'monday', 'weather')).toBe(0);
    expect(stdout.trim()).toBe("Moved the section 'Monday' from 'Journal' to the end of 'Weather'");
    expect(await run('show', 'weather', '--body')).toBe(0);
    expect(stdout.trim()).toBe('# Weather\n\n# Monday\n\nrain\n\n## Later\n\nsun');
    expect(await run('show', 'journal', '--body')).toBe(0);
    expect(stdout.trim()).toBe('intro\n\n# Tuesday\n\nwind');
    expect(await run('section', 'move', 'journal', 'nope', 'weather')).toBe(3);
  });

  it('renames a note and every link to it, unless told not to', async () => {
    await run('new', 'Plan', '--content', 'the plan, see [[plan]] myself');
    await run('new', 'Other', '--content', 'see [[Plan|the plan]] and [[Plane]]');
    expect(await run('rename', 'plan', 'Roadmap', '--dry-run')).toBe(0);
    expect(stderr).toContain("Rename 'Plan' to 'Roadmap' and update 2 links in 2 notes");
    expect(stdout).toContain('links rewritten');
    expect(await run('rename', 'plan', 'Roadmap')).toBe(0);
    expect(stdout.trim()).toBe("Renamed 'Plan' to 'Roadmap' and updated 2 links in 2 notes");
    expect(await run('show', 'other', '--body')).toBe(0);
    expect(stdout.trim()).toBe('see [[Roadmap|the plan]] and [[Plane]]');
    expect(await run('show', 'roadmap', '--body')).toBe(0);
    expect(stdout.trim()).toBe('the plan, see [[Roadmap]] myself');
    expect(await run('rename', 'roadmap', 'Plan B', '--no-links')).toBe(0);
    expect(await run('show', 'other', '--body')).toBe(0);
    expect(stdout.trim()).toBe('see [[Roadmap|the plan]] and [[Plane]]');
    expect(await run('rename', 'plan b', 'Plan B')).toBe(2);
    expect(await run('rename', 'plan b', '--clear')).toBe(0);
  });

  it('renames a tag everywhere, nested tags included, whole tokens only', async () => {
    await run('new', 'A', '--content', 'x #wow and #wow/commands');
    await run('new', 'B', '--content', '#wowza stays, http://a/#wow stays');
    expect(await run('tag', 'rename', 'wow', 'games')).toBe(0);
    expect(stdout.trim()).toBe('Renamed #wow to #games in 1 note (2 tags)');
    expect(await run('show', 'a', '--body')).toBe(0);
    expect(stdout.trim()).toBe('x #games and #games/commands');
    expect(await run('show', 'b', '--body')).toBe(0);
    expect(stdout.trim()).toBe('#wowza stays, http://a/#wow stays');
    expect(await run('tag', 'rename', 'games', 'two words')).toBe(2);
    expect(await run('tag', 'rename', 'nobody', 'x')).toBe(2);
  });

  it('merges a note into another: text appended under its title, links retargeted, source trashed', async () => {
    await run('new', 'Dup', '--content', 'the duplicate');
    await run('new', 'Plan', '--content', 'keep');
    await run('new', 'Other', '--content', 'see [[Dup]]');
    expect(await run('merge', 'dup', 'plan')).toBe(0);
    expect(stdout.trim()).toBe("Merged 'Dup' into 'Plan', updating 1 link in 1 note, and moved 'Dup' to the trash");
    expect(await run('show', 'plan', '--body')).toBe(0);
    expect(stdout.trim()).toBe('keep\n\n## Dup\n\nthe duplicate');
    expect(await run('show', 'other', '--body')).toBe(0);
    expect(stdout.trim()).toBe('see [[Plan]]');
    expect(await run('show', 'dup')).toBe(3);
    expect(await run('trash', 'list', '--plain')).toBe(0);
    expect(stdout).toContain('Dup');
    expect(await run('merge', 'plan', 'plan')).toBe(2);
  });

  it('refuses line:0 as a usage error rather than doing nothing', async () => {
    await run('new', 'Zero', '--content', '- [ ] one');
    expect(await run('task', 'zero', 'line:0', '--cycle')).toBe(2);
    expect(await run('task', 'zero', 'line:1', '--done')).toBe(0);
  });

  it('emits one JSON document for pin and unpin however many notes are named', async () => {
    await run('new', 'Alpha', '--content', 'a');
    await run('new', 'Beta', '--content', 'b');
    expect(await run('pin', 'alpha', 'beta', '--json')).toBe(0);
    const both = JSON.parse(stdout) as Array<{ title: string; pinned?: boolean }>;
    expect(both.map((n) => n.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(await run('unpin', 'alpha', '--json')).toBe(0);
    expect((JSON.parse(stdout) as { title: string }).title).toBe('Alpha');
  });
});

describe('0.22: folders on the command line', () => {
  it('makes folders, lists them with their counts, and files notes into them', async () => {
    expect(await run('folders', 'new', 'Work/Clients')).toBe(0);
    expect(await run('new', 'Hale', '--content', 'the client', '--folder', 'Work/Clients')).toBe(0);
    expect(await run('new', 'Loose', '--content', 'unfiled')).toBe(0);

    expect(await run('folders', 'list', '--plain')).toBe(0);
    // Both counts: a folder holding nothing but folders is not empty.
    expect(lines()).toEqual(['Work\t0\t1', 'Work/Clients\t1\t1']);

    expect(await run('list', '--folder', 'Work', '--plain')).toBe(0);
    expect(lines().map((l) => l.split('\t')[2])).toEqual(['Hale']);
    expect(await run('list', '--folder', '/', '--plain')).toBe(0);
    expect(lines().map((l) => l.split('\t')[2])).toEqual(['Loose']);
  });

  it('files a note in another folder without renaming it, and says where it went', async () => {
    await run('folders', 'new', 'Archive');
    await run('new', 'Plan', '--content', 'the plan');
    expect(await run('move', 'Plan', 'Archive')).toBe(0);
    expect(stdout).toContain('Archive/Plan.md');
    expect(await run('show', 'Plan', '--json')).toBe(0);
    const shown = JSON.parse(stdout);
    expect(shown.folder).toBe('Archive');
    expect(shown.path).toBe('Archive/Plan.md');
    expect(shown.title).toBe('Plan');
  });

  it('refuses a folder that is not there rather than making one on the way', async () => {
    await run('new', 'Plan');
    expect(await run('move', 'Plan', 'Nowhere')).toBe(3);
    expect(stderr).toContain('no folder called');
    expect(await run('new', 'Other', '--folder', 'Nowhere')).toBe(3);
  });

  it('refuses a folder name Windows will not keep, and never offers a different one', async () => {
    expect(await run('folders', 'new', 'Q1?Q2')).toBe(2);
    expect(stderr).toContain('"?"');
    expect(await run('folders', 'list', '--plain')).toBe(0);
    expect(lines()).toEqual([]);
  });

  it('renames and moves a folder, and only deletes an empty one', async () => {
    await run('folders', 'new', 'Work/Clients');
    await run('new', 'Hale', '--folder', 'Work/Clients', '--content', 'x');
    expect(await run('folders', 'rename', 'Work/Clients', 'Customers')).toBe(0);
    expect(stdout).toContain('Work / Customers');
    expect(await run('folders', 'delete', 'Work/Customers')).toBe(1);
    expect(stderr).toContain('still has something in it');
    await run('folders', 'new', 'Archive');
    expect(await run('folders', 'move', 'Work/Customers', 'Archive')).toBe(0);
    expect(await run('show', 'Hale', '--json')).toBe(0);
    expect(JSON.parse(stdout).folder).toBe('Archive/Customers');
  });

  it('names one note by its path when two notes share a title, and exits 7 when nothing does', async () => {
    await run('folders', 'new', 'Work');
    await run('folders', 'new', 'Home');
    await run('new', 'Plan', '--folder', 'Work', '--content', 'the work one');
    await run('new', 'Plan', '--folder', 'Home', '--content', 'the home one');
    expect(await run('show', 'Plan')).toBe(7);
    // The refusal lists where each one is, which is the whole point of saying 7.
    expect(stderr).toContain('Work/Plan');
    expect(await run('show', 'Work/Plan')).toBe(0);
    expect(stdout.trim()).toBe('the work one');
    expect(await run('show', 'Home/Plan.md')).toBe(0);
    expect(stdout.trim()).toBe('the home one');
  });

  it('imports into a folder', async () => {
    const file = path.join(root, 'Imported.md');
    await fs.writeFile(file, '# Imported\n\nfrom a file', 'utf8');
    await run('folders', 'new', 'Inbox');
    expect(await run('import', file, '--folder', 'Inbox')).toBe(0);
    expect(await run('show', 'Imported', '--json')).toBe(0);
    expect(JSON.parse(stdout).folder).toBe('Inbox');
  });

  it('answers folder: on the command line the same way the search box does', async () => {
    await run('folders', 'new', 'Work/Clients');
    await run('new', 'Hale', '--folder', 'Work/Clients', '--content', 'client');
    await run('new', 'Loose', '--content', 'client');
    expect(await run('search', 'client', 'folder:Work', '--plain')).toBe(0);
    expect(stdout).toContain('Hale');
    expect(stdout).not.toContain('Loose');
  });
});
