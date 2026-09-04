import { blockAtLine, blocksIn, withBlockId } from './blocks';
import { LINK_PATTERN, formatLinkAddress, linkKey, parseLinkAddress, titleOf } from '../renderer/notes';
import { headingAt, headingsIn } from '../renderer/outline';
import { linkMention } from './mentions';
import type { Note } from '../shared/types';

/**
 * Structural changes to the notebook, planned before they are made.
 *
 * Every operation here — moving lines or a section into another note,
 * renaming a note with its links, renaming a tag everywhere, merging two
 * notes — touches more than one file. Each is a pure function over the
 * notes that returns a Plan: exactly which notes change, from what to what,
 * and which go to the trash. The window shows the Plan before applying it
 * and undoes it as one step; the command line prints it for --dry-run and
 * applies it through the files or the running app. Nothing here does I/O,
 * so the two can never disagree about what an operation means.
 */

export type PlanKind = 'refile' | 'move-section' | 'rename' | 'tag-rename' | 'merge' | 'link-mention' | 'block-id';

export type ChangeKind = 'text added' | 'lines removed' | 'links rewritten' | 'tags rewritten' | 'renamed' | 'trashed' | 'address added';

/** A note as it must be for the Plan to apply, and as it will be afterwards. */
export interface NoteState {
  body: string;
  title?: string;
}

export interface Write {
  id: string;
  before: NoteState;
  after: NoteState;
}

export interface Plan {
  kind: PlanKind;
  /** One entry per note whose text or title changes. A merged-away note is never here. */
  writes: Write[];
  /** Notes to move to the trash after the writes, with the state they must still have. */
  trash: Array<{ id: string; before: NoteState }>;
  /** Notes to bring back from the trash before the writes: only an undone merge has any. */
  restore: Array<{ id: string; before: NoteState }>;
  summary: { notes: number; links?: number; tags?: number; lines?: number };
  /** Every note the Plan touches, with each effect on it, for the preview. */
  touched: Array<{ id: string; title: string; changes: ChangeKind[] }>;
  /** The note to show afterwards, when the operation moves the reader. */
  select?: string;
  /** The one sentence that says what the Plan does. */
  sentence: string;
}

export type PlanErrorCode = 'not_found' | 'same_note' | 'heading_not_found' | 'not_in_section' | 'bad_tag' | 'nothing_selected' | 'nothing_to_do';

export type PlanResult = { ok: true; plan: Plan } | { ok: false; code: PlanErrorCode; message: string };

/** Where text goes in a note: a heading, by the line it stands on, or an end of the note. */
export type Target = { line: number } | 'top' | 'end';

const fail = (code: PlanErrorCode, message: string): PlanResult => ({ ok: false, code, message });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const stateOf = (n: Note): NoteState => (n.title !== undefined ? { body: n.body, title: n.title } : { body: n.body });

const sameState = (a: NoteState, b: NoteState): boolean => a.body === b.body && (a.title ?? '') === (b.title ?? '');

// --- headings and sections --------------------------------------------------

const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]+\S/;

const isHeadingLine = (line: string): boolean => HEADING_LINE.test(line);

/**
 * The line after the last line of the section a heading opens: up to the next
 * heading of any level. The same headings the picker shows, so a `#` comment
 * inside a code fence does not end the section early and put words in the code.
 */
function sectionEnd(lines: string[], headingLine: number): number {
  const next = headingsIn(lines.join('\n')).find((h) => h.line > headingLine);
  return next ? next.line : lines.length;
}

/** Joins two blocks with one blank line between them, as the capture box does. */
function paragraphs(top: string, bottom: string): string {
  if (!top.trimEnd()) return bottom;
  if (!bottom.trim()) return top;
  return `${top.trimEnd()}\n\n${bottom}`;
}

/** The first heading in a body whose words are `text`, or -1. */
export function headingLineOf(body: string, text: string): number {
  const want = text.trim().toLowerCase();
  return headingsIn(body).find((h) => h.text.toLowerCase() === want)?.line ?? -1;
}

/**
 * Puts a block into a body: at the top, at the end (under a new heading if
 * one is named), or at the end of the section a heading opens. The block is
 * kept as it is; only the blank lines around it are arranged. Returns null
 * when the heading line named is not a heading.
 */
export function placeBlock(body: string, block: string, target: Target, createHeading?: string): string | null {
  const clean = block.replace(/\s+$/, '');
  if (target === 'top') return paragraphs(clean, body.replace(/^\n+/, ''));
  if (target === 'end') return paragraphs(body, createHeading ? `## ${createHeading.trim()}\n\n${clean}` : clean);
  const lines = body.split('\n');
  if (target.line < 0 || target.line >= lines.length || !isHeadingLine(lines[target.line])) return null;
  const end = sectionEnd(lines, target.line);
  const section = paragraphs(lines.slice(target.line, end).join('\n'), clean);
  const rest = lines.slice(end);
  const tail = rest.length > 0 ? `\n\n${rest.join('\n').replace(/^\n+/, '')}` : '';
  return `${lines.slice(0, target.line).join('\n')}${target.line > 0 ? '\n' : ''}${section}${tail}`;
}

/**
 * The command line's append: text at the end of a note, or at the top, or
 * at the end of the section under a heading named by its words (made at the
 * end of the note when there is none), or continuing the last line.
 */
export function insert(body: string, addition: string, opts: { prepend?: boolean; heading?: string; inline?: boolean }): string {
  if (opts.heading) {
    const at = headingLineOf(body, opts.heading);
    if (at < 0) return paragraphs(body, `## ${opts.heading.trim()}\n\n${addition}`);
    const lines = body.split('\n');
    const end = sectionEnd(lines, at);
    const section = lines.slice(at, end).join('\n');
    const merged = opts.inline ? `${section.trimEnd()} ${addition}` : paragraphs(section, addition);
    // Only the seam is tidied: blank lines elsewhere in the note (a code block's, say) are its own.
    const rest = lines.slice(end).join('\n').replace(/^\n+/, '');
    return [...lines.slice(0, at), ...merged.split('\n'), ...(rest ? ['', rest] : [])].join('\n');
  }
  if (opts.prepend) return body.trim() ? `${addition}\n\n${body.replace(/^\n+/, '')}` : addition;
  if (opts.inline) return body.trimEnd() ? `${body.trimEnd()} ${addition}` : addition;
  return paragraphs(body, addition.replace(/\r\n/g, '\n').trim());
}

/**
 * A body with lines first..last taken out and the blank lines around the gap
 * closed up, and how many lines went with them: `removed` for a line number
 * below the gap to carry over, `leading` (blank lines stripped from the top)
 * for one above it.
 */
function cutLines(body: string, first: number, last: number): { body: string; removed: number; leading: number } {
  const lines = body.split('\n');
  const kept = [...lines.slice(0, first), ...lines.slice(last + 1)];
  let removed = last - first + 1;
  // Two blank lines meeting across the gap become one.
  if (first > 0 && first < kept.length && !kept[first - 1].trim() && !kept[first].trim()) {
    kept.splice(first, 1);
    removed++;
  }
  let leading = 0;
  while (leading < kept.length && !kept[leading].trim()) leading++;
  return { body: kept.slice(leading).join('\n').replace(/\s+$/, ''), removed: removed + leading, leading };
}

const whereText = (to: Note, target: Target, createHeading?: string): string => {
  const title = titleOf(to);
  if (target === 'top') return `the top of '${title}'`;
  if (target === 'end') return createHeading ? `'${title}' under a new heading '${createHeading.trim()}'` : `the end of '${title}'`;
  const heading = headingsIn(to.body).find((h) => h.line === target.line);
  return `'${title}' under '${heading?.text ?? '?'}'`;
};

export interface RefileRequest {
  from: string;
  /** Lines of `from` to move, counted from 0, inclusive. */
  first: number;
  last: number;
  to: string;
  target: Target;
  /** A heading to make at the end of `to`, when `target` is 'end' and the text should sit under one. */
  createHeading?: string;
}

/** Moves lines from one note into another (or elsewhere in the same one), the text kept as it is. */
export function planRefile(notes: Note[], req: RefileRequest, kind: PlanKind = 'refile', label?: string): PlanResult {
  const from = notes.find((n) => n.id === req.from);
  const to = notes.find((n) => n.id === req.to);
  if (!from) return fail('not_found', 'The note to move from is gone');
  if (!to) return fail('not_found', 'The destination note is gone');
  const lines = from.body.split('\n');
  if (req.first < 0 || req.last >= lines.length || req.first > req.last) return fail('nothing_selected', 'Those lines are not in the note');
  const block = lines.slice(req.first, req.last + 1).join('\n');
  if (!block.trim()) return fail('nothing_selected', 'Nothing to move: the lines are blank');
  const count = req.last - req.first + 1;

  let fromBody: string;
  let toBody: string | null;
  if (from.id === to.id) {
    let target = req.target;
    if (typeof target === 'object') {
      if (target.line >= req.first && target.line <= req.last) return fail('same_note', 'That heading is inside the lines being moved');
    }
    const cut = cutLines(from.body, req.first, req.last);
    // The destination was found before the cut; below the gap it moves up by
    // what went, above it only by the blank lines stripped from the top.
    if (typeof target === 'object') target = { line: target.line - (target.line > req.last ? cut.removed : cut.leading) };
    toBody = placeBlock(cut.body, block, target, req.createHeading);
    fromBody = toBody ?? from.body;
  } else {
    fromBody = cutLines(from.body, req.first, req.last).body;
    toBody = placeBlock(to.body, block, req.target, req.createHeading);
  }
  if (toBody === null) return fail('heading_not_found', 'That heading is not in the destination note');

  const writes: Write[] = [];
  const touched: Plan['touched'] = [];
  if (from.id === to.id) {
    if (toBody === from.body) return fail('nothing_to_do', 'The lines are already there');
    writes.push({ id: from.id, before: stateOf(from), after: { ...stateOf(from), body: toBody } });
    touched.push({ id: from.id, title: titleOf(from), changes: ['lines removed', 'text added'] });
  } else {
    writes.push({ id: from.id, before: stateOf(from), after: { ...stateOf(from), body: fromBody } });
    writes.push({ id: to.id, before: stateOf(to), after: { ...stateOf(to), body: toBody } });
    touched.push({ id: from.id, title: titleOf(from), changes: ['lines removed'] }, { id: to.id, title: titleOf(to), changes: ['text added'] });
  }
  const what = label ?? plural(count, 'line');
  const sentence = from.id === to.id ? `Move ${what} to ${whereText(to, req.target, req.createHeading)}` : `Move ${what} from '${titleOf(from)}' to ${whereText(to, req.target, req.createHeading)}`;
  return { ok: true, plan: { kind, writes, trash: [], restore: [], summary: { notes: writes.length, lines: count }, touched, sentence } };
}

export interface MoveSectionRequest {
  from: string;
  /** Any line inside the section. */
  line: number;
  to: string;
  target: Target;
  createHeading?: string;
}

/** The lines of the section around a line: its heading through the line before the next heading of the same or a higher level. */
export function sectionAround(body: string, line: number): { first: number; last: number; text: string } | null {
  const headings = headingsIn(body);
  const at = headingAt(headings, line);
  if (at < 0) return null;
  const head = headings[at];
  const next = headings.slice(at + 1).find((h) => h.level <= head.level);
  const lines = body.split('\n');
  let last = (next ? next.line : lines.length) - 1;
  while (last > head.line && !lines[last].trim()) last--;
  return { first: head.line, last, text: head.text };
}

/** Moves a heading and everything under it into another note, levels untouched. */
export function planMoveSection(notes: Note[], req: MoveSectionRequest): PlanResult {
  const from = notes.find((n) => n.id === req.from);
  if (!from) return fail('not_found', 'The note to move from is gone');
  const section = sectionAround(from.body, req.line);
  if (!section) return fail('not_in_section', 'Put the caret in a section first');
  if (typeof req.target === 'object' && req.from === req.to && req.target.line >= section.first && req.target.line <= section.last) {
    return fail('same_note', 'That heading is inside the section being moved');
  }
  return planRefile(notes, { from: req.from, first: section.first, last: section.last, to: req.to, target: req.target, createHeading: req.createHeading }, 'move-section', `the section '${section.text}'`);
}

// --- links and tags ----------------------------------------------------------

const LINK = new RegExp(LINK_PATTERN, 'g');

/**
 * Every [[link]] to a title rewritten to another; how many were changed.
 *
 * Only the note the link names moves. Its fragment and its alias are separate
 * parts of the address and come through untouched, so `[[Plan#^k3n9dq|the
 * decision]]` becomes `[[Work/Plan#^k3n9dq|the decision]]` and points at the
 * same words it always did.
 */
export function rewriteLinks(body: string, from: string, to: string): { body: string; count: number } {
  const want = linkKey(from);
  let count = 0;
  const next = body.replace(LINK, (whole, inner: string) => {
    const address = parseLinkAddress(inner);
    if (linkKey(address.target) !== want) return whole;
    count++;
    return `[[${formatLinkAddress({ ...address, target: to.trim() })}]]`;
  });
  return { body: next, count };
}

export interface RenameRequest {
  id: string;
  title: string;
  /** Rewrite [[links]] to the old title everywhere. */
  links: boolean;
}

/** Gives a note a title, and points every link at the new name. */
export function planRename(notes: Note[], req: RenameRequest): PlanResult {
  const note = notes.find((n) => n.id === req.id);
  if (!note) return fail('not_found', 'That note is gone');
  const title = req.title.trim();
  if (!title) return fail('nothing_selected', 'Give the new title');
  const old = titleOf(note);
  if ((note.title ?? '') === title) return fail('nothing_to_do', `The note is already called '${title}'`);
  const writes: Write[] = [];
  const touched: Plan['touched'] = [];
  let links = 0;
  let linkedNotes = 0;
  for (const n of notes) {
    const rewritten = req.links && linkKey(old) !== linkKey(title) ? rewriteLinks(n.body, old, title) : { body: n.body, count: 0 };
    if (n.id === note.id) {
      const changes: ChangeKind[] = ['renamed'];
      if (rewritten.count > 0) changes.push('links rewritten');
      writes.push({ id: n.id, before: stateOf(n), after: { body: rewritten.body, title } });
      touched.push({ id: n.id, title: old, changes });
    } else if (rewritten.count > 0) {
      writes.push({ id: n.id, before: stateOf(n), after: { ...stateOf(n), body: rewritten.body } });
      touched.push({ id: n.id, title: titleOf(n), changes: ['links rewritten'] });
    }
    if (rewritten.count > 0) {
      links += rewritten.count;
      linkedNotes++;
    }
  }
  const sentence = `Rename '${old}' to '${title}'${links > 0 ? ` and update ${plural(links, 'link')} in ${plural(linkedNotes, 'note')}` : ''}`;
  return { ok: true, plan: { kind: 'rename', writes, trash: [], restore: [], summary: { notes: writes.length, links }, touched, sentence } };
}

/**
 * Joins one note up to another it already talks about: the words that name
 * the target become a `[[link]]`, in place, spelling and capitals kept. A
 * Plan like any other, so it is previewed, undone in one step and refused
 * if the note has moved on since the mention was found.
 */
export function planLinkMention(notes: Note[], fromId: string, targetId: string, at: { start: number; end: number }): PlanResult {
  const from = notes.find((n) => n.id === fromId);
  const target = notes.find((n) => n.id === targetId);
  if (!from || !target) return fail('not_found', 'That note is gone');
  if (from.id === target.id) return fail('same_note', 'A note cannot link to itself');
  const body = linkMention(from.body, at, target);
  if (body === null || body === from.body) return fail('nothing_to_do', 'Those words are not there any more');
  const written = from.body.slice(at.start, at.end);
  return {
    ok: true,
    plan: {
      kind: 'link-mention',
      writes: [{ id: from.id, before: stateOf(from), after: { ...stateOf(from), body } }],
      trash: [],
      restore: [],
      summary: { notes: 1, links: 1 },
      touched: [{ id: from.id, title: titleOf(from), changes: ['links rewritten'] }],
      sentence: `Link '${written}' in '${titleOf(from)}' to '${titleOf(target)}'`,
    },
  };
}

/** A tag as it may be written: letters first, then letters, digits, _ and -, nested with /. */
const TAG_NAME = /^\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*$/u;

export const cleanTag = (tag: string): string => tag.trim().replace(/^#/, '').toLowerCase();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Every #from and #from/child rewritten to #to, whole tokens only, as tagsOf reads them. */
export function rewriteTags(body: string, from: string, to: string): { body: string; count: number } {
  // A trailing slash (`#wow/`) is not part of the tag, as tagsOf reads it, so it ends the token too.
  const re = new RegExp(`(?:^|(?<=\\s))#${escapeRe(from)}(?=/[\\p{L}\\p{N}_-]|(?![\\p{L}\\p{N}_-]))`, 'giu');
  let count = 0;
  const next = body.replace(re, () => {
    count++;
    return `#${to}`;
  });
  return { body: next, count };
}

/** Renames a tag in every note that carries it, nested tags included. */
export function planTagRename(notes: Note[], req: { from: string; to: string }): PlanResult {
  const from = cleanTag(req.from);
  const to = cleanTag(req.to);
  if (!TAG_NAME.test(from)) return fail('bad_tag', `'${req.from}' is not a tag`);
  if (!TAG_NAME.test(to)) return fail('bad_tag', `'${req.to}' is not a tag: letters, digits, _ and -, nested with /`);
  if (from === to) return fail('nothing_to_do', `#${from} already has that name`);
  const writes: Write[] = [];
  const touched: Plan['touched'] = [];
  let tags = 0;
  for (const n of notes) {
    const r = rewriteTags(n.body, from, to);
    if (r.count === 0) continue;
    tags += r.count;
    writes.push({ id: n.id, before: stateOf(n), after: { ...stateOf(n), body: r.body } });
    touched.push({ id: n.id, title: titleOf(n), changes: ['tags rewritten'] });
  }
  if (writes.length === 0) return fail('nothing_to_do', `No note carries #${from}`);
  const sentence = `Rename #${from} to #${to} in ${plural(writes.length, 'note')} (${plural(tags, 'tag')})`;
  return { ok: true, plan: { kind: 'tag-rename', writes, trash: [], restore: [], summary: { notes: writes.length, tags }, touched, sentence } };
}

// --- block addresses -----------------------------------------------------------

/**
 * Writes a `^id` onto one block of a note, so a link can point at it.
 *
 * A Plan rather than a bare edit because the block may be in a note nobody is
 * looking at: this way the write is checked against the note as it now stands,
 * lands on that note's own undo log, and can be taken back with one Ctrl+Z
 * from the note it happened to.
 */
export function planBlockId(notes: Note[], req: { id: string; line: number; blockId: string }): PlanResult {
  const note = notes.find((n) => n.id === req.id);
  if (!note) return fail('not_found', 'That note is gone');
  const block = blockAtLine(note.body, req.line);
  if (!block) return fail('nothing_selected', 'There is nothing there a link can point at');
  if (block.id) return fail('nothing_to_do', `That block is already ^${block.id}`);
  const after = { ...stateOf(note), body: withBlockId(note.body, block, req.blockId) };
  const sentence = `Give that block of '${titleOf(note)}' the address ^${req.blockId}`;
  return {
    ok: true,
    plan: {
      kind: 'block-id',
      writes: [{ id: note.id, before: stateOf(note), after }],
      trash: [],
      restore: [],
      summary: { notes: 1 },
      touched: [{ id: note.id, title: titleOf(note), changes: ['address added'] }],
      sentence,
    },
  };
}

/** What moving addressed text is about to break. */
export interface BlockFallout {
  /** Block ids leaving the note they were addressed in. */
  lost: string[];
  /** Links elsewhere in the notebook pointing at those ids in that note. */
  links: number;
  /** Ids that would end up written twice in the note the text lands in. */
  collisions: string[];
}

/**
 * What a Plan that moves text would do to the block links pointing at it.
 *
 * Block ids belong to the note they are written in, so text carrying one into
 * another note leaves every `[[This#^id]]` pointing at nothing — and if the
 * destination already uses that id, at two things. Neither is rewritten:
 * doing so would need a cross-note refactor with no sensible answer for a
 * half-selected block. What happens instead is that the move says so first.
 */
export function blockFallout(plan: Plan, notes: readonly Note[]): BlockFallout | null {
  const lost: string[] = [];
  const collisions: string[] = [];
  let links = 0;
  for (const write of plan.writes) {
    const before = blocksIn(write.before.body).map((b) => b.id).filter(Boolean);
    const after = blocksIn(write.after.body).map((b) => b.id).filter(Boolean);
    for (const id of before) {
      if (after.includes(id) || lost.includes(id)) continue;
      lost.push(id);
      const note = notes.find((n) => n.id === write.id);
      if (note) links += linksToBlock(notes, note, id);
    }
    for (const id of after) {
      if (after.indexOf(id) !== after.lastIndexOf(id) && !collisions.includes(id)) collisions.push(id);
    }
  }
  return lost.length === 0 && collisions.length === 0 ? null : { lost, links, collisions };
}

/** How many links in the notebook point at one block of one note. */
function linksToBlock(notes: readonly Note[], note: Note, blockId: string): number {
  const want = linkKey(titleOf(note));
  let count = 0;
  for (const other of notes) {
    for (const m of other.body.matchAll(new RegExp(LINK_PATTERN, 'g'))) {
      const address = parseLinkAddress(m[1]);
      if (address.block !== blockId) continue;
      // A link with no note name means the note it is written in.
      if (address.target ? linkKey(address.target) === want || linkKey(address.target).endsWith(`/${want}`) : other.id === note.id) count++;
    }
  }
  return count;
}

/** The sentence a move shows before it breaks anything. */
export function falloutSentence(fallout: BlockFallout): string {
  const said: string[] = [];
  if (fallout.links > 0) said.push(`will break ${plural(fallout.links, 'block link')} to this note`);
  else if (fallout.lost.length > 0) said.push(`takes ${plural(fallout.lost.length, 'block address')} out of this note`);
  if (fallout.collisions.length > 0) said.push(`makes ${fallout.collisions.map((id) => `^${id}`).join(', ')} ambiguous where it lands`);
  return `Moving this text ${said.join(', and ')}`;
}

// --- merge ---------------------------------------------------------------------

const HEADING_TEXT = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Appends one note to another, points links at the survivor, and trashes the source. */
export function planMerge(notes: Note[], req: { source: string; into: string }): PlanResult {
  const source = notes.find((n) => n.id === req.source);
  const into = notes.find((n) => n.id === req.into);
  if (!source) return fail('not_found', 'The note to merge is gone');
  if (!into) return fail('not_found', 'The destination note is gone');
  if (source.id === into.id) return fail('same_note', 'A note cannot be merged into itself');
  const sourceTitle = titleOf(source);
  const intoTitle = titleOf(into);
  const text = source.body.replace(/\s+$/, '').replace(/^\n+/, '');
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  const heading = HEADING_TEXT.exec(firstLine);
  const ownHeading = heading !== null && heading[1].trim().toLowerCase() === sourceTitle.toLowerCase();
  const block = !text.trim() ? '' : ownHeading ? text : `## ${sourceTitle}\n\n${text}`;
  const merged = block ? paragraphs(into.body, block) : into.body;

  const writes: Write[] = [];
  const touched: Plan['touched'] = [];
  let links = 0;
  let linkedNotes = 0;
  const retarget = linkKey(sourceTitle) !== linkKey(intoTitle);
  for (const n of notes) {
    if (n.id === source.id) continue;
    const base = n.id === into.id ? merged : n.body;
    const r = retarget ? rewriteLinks(base, sourceTitle, intoTitle) : { body: base, count: 0 };
    if (r.count > 0) {
      links += r.count;
      linkedNotes++;
    }
    if (r.body === n.body) continue;
    const changes: ChangeKind[] = [];
    if (n.id === into.id && block) changes.push('text added');
    if (r.count > 0) changes.push('links rewritten');
    writes.push({ id: n.id, before: stateOf(n), after: { ...stateOf(n), body: r.body } });
    touched.push({ id: n.id, title: titleOf(n), changes });
  }
  touched.push({ id: source.id, title: sourceTitle, changes: ['trashed'] });
  const sentence = `Merge '${sourceTitle}' into '${intoTitle}'${links > 0 ? `, updating ${plural(links, 'link')} in ${plural(linkedNotes, 'note')},` : ''} and move '${sourceTitle}' to the trash`;
  return {
    ok: true,
    plan: { kind: 'merge', writes, trash: [{ id: source.id, before: stateOf(source) }], restore: [], summary: { notes: writes.length + 1, links }, touched, select: into.id, sentence },
  };
}

// --- applying -------------------------------------------------------------------

export const describePlan = (plan: Plan): string => plan.sentence;

export type CheckResult = { ok: true } | { ok: false; code: 'stale'; message: string };

/** Whether every note the Plan touches still stands as the Plan expects. */
export function checkPlan(plan: Plan, notes: Note[]): CheckResult {
  const stale = (title: string): CheckResult => ({ ok: false, code: 'stale', message: `'${title}' changed meanwhile; look again and retry` });
  for (const w of plan.writes) {
    const live = notes.find((n) => n.id === w.id);
    if (!live) return { ok: false, code: 'stale', message: 'A note the change needs is gone; retry' };
    if (!sameState(stateOf(live), w.before)) return stale(titleOf(live));
  }
  for (const t of plan.trash) {
    const live = notes.find((n) => n.id === t.id);
    if (!live) return { ok: false, code: 'stale', message: 'The note to merge is already gone; retry' };
    if (!sameState(stateOf(live), t.before)) return stale(titleOf(live));
  }
  for (const r of plan.restore) {
    if (notes.some((n) => n.id === r.id)) return { ok: false, code: 'stale', message: 'The note to put back is already among the notes' };
  }
  return { ok: true };
}

/** The notes as they stand once a Plan is applied: written notes replaced, trashed ones dropped. */
export function applyPlanTo(plan: Plan, notes: Note[], now = Date.now()): Note[] {
  const gone = new Set(plan.trash.map((t) => t.id));
  return notes
    .filter((n) => !gone.has(n.id))
    .map((n) => {
      const w = plan.writes.find((x) => x.id === n.id);
      if (!w) return n;
      const { title: _old, ...rest } = n;
      return w.after.title !== undefined ? { ...rest, title: w.after.title, body: w.after.body, updatedAt: now } : { ...rest, body: w.after.body, updatedAt: now };
    });
}

/** The Plan that puts everything back: each write reversed, each trashed note to be restored. */
export function invertPlan(plan: Plan): Plan {
  return {
    ...plan,
    writes: plan.writes.map((w) => ({ id: w.id, before: w.after, after: w.before })),
    trash: plan.restore,
    restore: plan.trash,
    sentence: plan.sentence.startsWith('Undo: ') ? plan.sentence.slice(6) : `Undo: ${plan.sentence}`,
  };
}
