/**
 * Blocks: addressing a paragraph or a list item, not just a heading.
 *
 * `[[Note#Heading]]` has always worked, and `sectionOf` finds a heading and
 * everything under it. A block is the same idea, smaller: a `^k3n9dq` marker
 * on a paragraph, a list item, a heading, a quote, a table or a fenced block
 * makes those lines something a link can point at.
 *
 * Two rules hold the feature down to something honest:
 *
 * - **An id is minted only when a person asks for one.** Nothing here runs on
 *   load, on save, on render or on hover. Reading a note never changes it.
 * - **Once written, the marker is ordinary text.** It can be edited away, and
 *   nothing puts it back. Two blocks carrying the same id are ambiguous and
 *   are reported as such; the app does not choose one.
 *
 * Ids are scoped to their note. `^k3n9dq` in one note and `^k3n9dq` in another
 * are unrelated, and nothing tries to make them unique across the notebook.
 *
 * This is not a block editor. Paragraphs and list items gain addresses; they
 * do not gain identities, nesting semantics or a database behind the markdown.
 */

/** What kind of thing an address points at. */
export type BlockKind = 'paragraph' | 'list-item' | 'heading' | 'blockquote' | 'table' | 'code';

/** One addressable run of lines. */
export interface BlockSlice {
  id: string;
  kind: BlockKind;
  /** The first line of the block, counting from 0. */
  start: number;
  /** One past its last line. */
  end: number;
  /** The block's markdown with the marker taken out, ready to embed. */
  content: string;
}

/** What looking for an id in a note found. */
export type BlockResolution = { kind: 'one'; block: BlockSlice } | { kind: 'none' } | { kind: 'many'; blocks: BlockSlice[] };

/** The shape of an id: Obsidian's own, six lowercase letters and digits. */
const ID = '[A-Za-z0-9][A-Za-z0-9-]*';

/** A marker at the end of a line, after a space: `words here ^k3n9dq`. */
const INLINE = new RegExp(`\\s\\^(${ID})\\s*$`);

/** A marker on a line of its own, which is how a table or a fence is addressed. */
const STANDALONE = new RegExp(`^[ \\t]*\\^(${ID})[ \\t]*$`);

const FENCE = /^[ \t]*(```+|~~~+)/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/** True when a line is a table row: it has a pipe and is not something else. */
const isTableRow = (line: string): boolean => line.includes('|') && line.trim() !== '' && !FENCE.test(line) && !HEADING.test(line);

/** The id a line carries, written at its end or on a line of its own. */
export function markerOn(line: string): { id: string; standalone: boolean } | null {
  const alone = STANDALONE.exec(line);
  if (alone) return { id: alone[1], standalone: true };
  const inline = INLINE.exec(line);
  return inline ? { id: inline[1], standalone: false } : null;
}

/** A line with its marker taken off, which is what an embed shows. */
export const withoutMarker = (line: string): string => line.replace(INLINE, '');

/**
 * Every line of a note that is inside a fenced code block, so a `^id` written
 * in an example is the characters that were typed and not an address.
 */
function fenced(lines: readonly string[]): { inside: boolean[]; opens: boolean[] } {
  const inside = new Array<boolean>(lines.length).fill(false);
  // Which lines open a block. `inside` alone cannot tell two fences written
  // straight after one another from one long fence.
  const opens = new Array<boolean>(lines.length).fill(false);
  let open: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open === null) {
      if (m) {
        open = m[1][0];
        inside[i] = true;
        opens[i] = true;
      }
    } else {
      inside[i] = true;
      if (m && m[1][0] === open) open = null;
    }
  }
  // An unclosed fence runs to the end and nothing inside it is addressable.
  return { inside, opens };
}

/** True when the line starts something other than more of the paragraph above it. */
const startsBlock = (line: string): boolean => HEADING.test(line) || QUOTE.test(line) || RULE.test(line) || LIST.test(line) || FENCE.test(line) || line.trim() === '';

/** How far a list item reaches: its own line, then everything indented under it. */
function listItemEnd(lines: readonly string[], start: number, inFence: readonly boolean[]): number {
  const m = LIST.exec(lines[start]);
  const indent = width(m ? m[1] : '');
  let end = start + 1;
  let blanks = 0;
  for (; end < lines.length; end++) {
    if (inFence[end]) {
      // A fence opened inside the item belongs to it.
      if (width(leading(lines[end])) <= indent && !inFence[end - 1]) break;
      blanks = 0;
      continue;
    }
    if (lines[end].trim() === '') {
      blanks++;
      // Two blank lines end the item whatever follows.
      if (blanks > 1) break;
      continue;
    }
    // A line at or left of the marker's own column is the next item or has left the list.
    if (width(leading(lines[end])) <= indent) break;
    blanks = 0;
  }
  // Trailing blanks belong to whatever comes next, not to the item.
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return end;
}

const leading = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? '';

/** A tab counts as four columns, which is how markdown reckons indentation. */
const width = (space: string): number => [...space].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);

/** The block starting at a line, and where it ends. Null for a line that starts nothing. */
function blockAt(lines: readonly string[], start: number, inFence: readonly boolean[], opens: readonly boolean[]): { kind: BlockKind; end: number } | null {
  const line = lines[start];
  if (line.trim() === '' || RULE.test(line)) return null;
  if (inFence[start]) {
    // Only the opening fence starts a block, and only a closed one is addressable.
    if (!opens[start]) return null;
    // The block ends at its own closing fence. Running on to the end of the
    // run of fenced lines swallowed every block written straight after it: the
    // second of two adjacent code blocks could not be addressed at all, and an
    // id meant for the first was written after the second.
    let end = start + 1;
    while (end < lines.length && inFence[end] && !FENCE.test(lines[end])) end++;
    const closed = end < lines.length && inFence[end] && FENCE.test(lines[end]);
    return closed ? { kind: 'code', end: end + 1 } : null;
  }
  if (HEADING.test(line)) return { kind: 'heading', end: start + 1 };
  if (QUOTE.test(line)) {
    let end = start + 1;
    while (end < lines.length && QUOTE.test(lines[end])) end++;
    return { kind: 'blockquote', end };
  }
  if (LIST.test(line)) return { kind: 'list-item', end: listItemEnd(lines, start, inFence) };
  if (isTableRow(line) && TABLE_SEP.test(lines[start + 1] ?? '')) {
    let end = start + 2;
    while (end < lines.length && isTableRow(lines[end])) end++;
    return { kind: 'table', end };
  }
  let end = start + 1;
  while (end < lines.length && !inFence[end] && !startsBlock(lines[end]) && !(isTableRow(lines[end]) && TABLE_SEP.test(lines[end + 1] ?? ''))) end++;
  return { kind: 'paragraph', end };
}

/** The kinds whose marker goes on a line of its own, after the block. */
const STANDS_ALONE = new Set<BlockKind>(['table', 'code']);

/**
 * Every addressable block in a note, in order, whether or not it carries an id.
 *
 * This is what the "Link to a block…" picker lists and what `notes show --json`
 * reports. A block with no id has an empty one; minting is a separate step and
 * happens only when somebody chooses that row.
 */
export function blocksIn(body: string): BlockSlice[] {
  const lines = body.split('\n');
  const { inside: inFence, opens } = fenced(lines);
  const out: BlockSlice[] = [];
  // A list item is addressable, and so is each item nested inside it — one
  // holds the other, which is why the walk goes in rather than past.
  const walk = (from: number, to: number, itemsOnly: boolean): void => {
    for (let i = from; i < to; ) {
      if (itemsOnly && (inFence[i] || !LIST.test(lines[i]))) {
        i++;
        continue;
      }
      const found = blockAt(lines, i, inFence, opens);
      if (!found) {
        i++;
        continue;
      }
      let end = Math.min(found.end, to);
      let id = '';
      if (STANDS_ALONE.has(found.kind)) {
        // Its marker is the line immediately after it, with no blank between.
        const after = markerOn(lines[end] ?? '');
        if (after?.standalone) {
          id = after.id;
          end++;
        }
      } else {
        const own = markerOn(lines[found.kind === 'list-item' ? i : end - 1] ?? '');
        if (own && !own.standalone) id = own.id;
      }
      out.push({ id, kind: found.kind, start: i, end, content: contentOf(lines, i, end, found.kind) });
      if (found.kind === 'list-item') walk(i + 1, end, true);
      i = end;
    }
  };
  walk(0, lines.length, false);
  return out;
}

/** A block's markdown, marker removed and a nested item brought back to the left. */
function contentOf(lines: readonly string[], start: number, end: number, kind: BlockKind): string {
  const rows = lines.slice(start, end).map((line) => (markerOn(line)?.standalone ? null : withoutMarker(line)));
  const kept = rows.filter((line): line is string => line !== null);
  if (kind !== 'list-item') return kept.join('\n').replace(/\s+$/, '');
  // A deeply nested item stands alone once its own indentation goes.
  const indent = width(leading(kept[0] ?? ''));
  if (indent === 0) return kept.join('\n').replace(/\s+$/, '');
  return kept
    .map((line) => {
      let cut = 0;
      let seen = 0;
      while (cut < line.length && seen < indent && (line[cut] === ' ' || line[cut] === '\t')) {
        seen += line[cut] === '\t' ? 4 : 1;
        cut++;
      }
      return line.slice(cut);
    })
    .join('\n')
    .replace(/\s+$/, '');
}

/**
 * The source with its addresses taken off, for anything that is read rather
 * than edited: the preview, every rendered export and the offline render.
 *
 * A `^id` is how the source says where a link may point; it is not something
 * to read. The editor keeps it visible because it is the file's own text —
 * every rendered surface takes it away. A marker inside a fence is an example
 * somebody typed and stays exactly as it is.
 */
export function withoutMarkers(body: string): string {
  const lines = body.split('\n');
  const { inside: inFence } = fenced(lines);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) {
      out.push(lines[i]);
      continue;
    }
    const found = markerOn(lines[i]);
    // A marker on a line of its own takes the line with it.
    if (found?.standalone) continue;
    out.push(found ? withoutMarker(lines[i]) : lines[i]);
  }
  return out.join('\n');
}

/**
 * The block an id names, in this note.
 *
 * None, one, or more than one — and more than one is answered as ambiguous
 * rather than by choosing, for the same reason `[[Plan]]` matching two notes
 * asks rather than guesses: which one it meant is not something to invent.
 */
export function blockOf(body: string, id: string): BlockResolution {
  const want = normalizeId(id);
  const hits = blocksIn(body).filter((b) => b.id === want);
  if (hits.length === 0) return { kind: 'none' };
  return hits.length === 1 ? { kind: 'one', block: hits[0] } : { kind: 'many', blocks: hits };
}

/** An id as it is compared: `^abc` and `abc` are the same address. */
export const normalizeId = (id: string): string => id.trim().replace(/^\^/, '');

/** The characters an id is made of: lowercase, so it reads as an address and not a word. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new id, six characters, not already used in this note. */
export function newBlockId(body: string, random: () => number = Math.random): string {
  const taken = new Set(blocksIn(body).map((b) => b.id));
  for (let attempt = 0; ; attempt++) {
    let id = '';
    for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (!taken.has(id)) return id;
    // Random ran out of luck, or is not random: lengthen rather than loop forever.
    if (attempt > 40) return `${id}${attempt}`;
  }
}

/**
 * The block the caret's line is inside, or null when that line is not
 * addressable. The innermost one, so a caret in a nested item addresses that
 * item rather than the one holding it.
 */
export function blockAtLine(body: string, line: number): BlockSlice | null {
  const inside = blocksIn(body).filter((b) => line >= b.start && line < b.end);
  return inside.length > 0 ? inside[inside.length - 1] : null;
}

/** A note's body with an id written onto one of its blocks, and the id that went on. */
export function withBlockId(body: string, block: BlockSlice, id: string): string {
  const lines = body.split('\n');
  if (STANDS_ALONE.has(block.kind)) {
    // On its own line, immediately after the block, with no blank between.
    lines.splice(block.end, 0, `^${id}`);
  } else {
    // At the end of the line that carries the block's own words: the item's
    // first line, or the last line of a paragraph or a quote.
    const at = block.kind === 'list-item' ? block.start : block.end - 1;
    lines[at] = `${lines[at].replace(/\s+$/, '')} ^${id}`;
  }
  return lines.join('\n');
}

/**
 * A one-line description of a block, for the picker and the pretty output.
 * Enough to recognise it by, never enough to fill the row.
 */
export function summarize(block: BlockSlice, width = 60): string {
  const text = block.content
    .split('\n')
    .map((line) => line.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])\s+/, '').replace(/^[ \t]*>+\s?/, '').replace(/^\s*#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '(empty)';
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}
