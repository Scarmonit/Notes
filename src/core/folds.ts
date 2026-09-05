import { isFenceLine } from '../renderer/fences';

/**
 * Folding, as arithmetic on lines. A heading owns its section down to the
 * next heading of the same or a higher level; a list item with an indented
 * sub-list owns that sub-list. Either can be folded: the head line stays and
 * the lines under it hide. None of this touches the text — a fold is a way of
 * looking, kept per note beside the window's other conveniences and never
 * written into the file.
 */

export type FoldKind = 'heading' | 'list';

/** One thing that can fold: its head line, and the first line after what it owns. */
export interface FoldRange {
  head: number;
  /** One past the last hidden line. `end - head - 1` lines hide. */
  end: number;
  kind: FoldKind;
  /** A heading's level, or a list item's indentation in columns. */
  depth: number;
  /** The head line's words, trimmed, for finding it again after the text moved. */
  text: string;
}

/** What is remembered of a fold: enough to find its head again. */
export interface FoldHead {
  line: number;
  kind: FoldKind;
  depth: number;
  text: string;
}

export interface NoteFolds {
  updatedAt: number;
  heads: FoldHead[];
}

/** How many notes' folds are kept; the least recently changed goes first. */
export const FOLDS_KEPT = 200;

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

const width = (space: string): number => [...space].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
const leading = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? '';

/** Which lines sit inside a code fence, so a `#` there is code and not a heading. */
function fenced(lines: readonly string[]): boolean[] {
  const inside = new Array<boolean>(lines.length).fill(false);
  let open = false;
  lines.forEach((line, i) => {
    if (isFenceLine(line)) {
      inside[i] = true;
      open = !open;
      return;
    }
    inside[i] = open;
  });
  return inside;
}

/** How far a list item reaches: its own line, then everything indented under it, blank lines allowed between. */
function listItemEnd(lines: readonly string[], start: number, indent: number, inFence: readonly boolean[]): number {
  let end = start + 1;
  let blanks = 0;
  for (; end < lines.length; end++) {
    if (inFence[end]) {
      if (width(leading(lines[end])) <= indent && !inFence[end - 1]) break;
      blanks = 0;
      continue;
    }
    if (lines[end].trim() === '') {
      blanks++;
      if (blanks > 1) break;
      continue;
    }
    if (width(leading(lines[end])) <= indent) break;
    blanks = 0;
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return end;
}

/** Every heading and every list item with something indented under it, in line order. Empty sections are not foldable. */
export function foldableRanges(lines: readonly string[]): FoldRange[] {
  const out: FoldRange[] = [];
  const inFence = fenced(lines);
  const headings: Array<{ line: number; level: number; text: string }> = [];
  lines.forEach((line, i) => {
    if (inFence[i]) return;
    const h = HEADING.exec(line);
    if (h) headings.push({ line: i, level: h[1].length, text: h[2].trim() });
  });
  headings.forEach((h, i) => {
    const next = headings.slice(i + 1).find((o) => o.level <= h.level);
    let end = next ? next.line : lines.length;
    // Blank lines before the next heading belong to nobody; a section of nothing but them is empty.
    while (end > h.line + 1 && lines[end - 1].trim() === '') end--;
    if (end > h.line + 1) out.push({ head: h.line, end, kind: 'heading', depth: h.level, text: h.text });
  });
  lines.forEach((line, i) => {
    if (inFence[i]) return;
    const m = LIST.exec(line);
    if (!m) return;
    const indent = width(m[1]);
    const end = listItemEnd(lines, i, indent, inFence);
    // Only an item with an indented line under it — a sub-list, a continuation — folds.
    if (end > i + 1) out.push({ head: i, end, kind: 'list', depth: indent, text: m[3].trim() });
  });
  return out.sort((a, b) => a.head - b.head || a.end - b.end);
}

/** The foldable range whose head is this line, or null. */
export function foldableAt(ranges: readonly FoldRange[], line: number): FoldRange | null {
  return ranges.find((r) => r.head === line) ?? null;
}

/** The innermost range hiding this line when folded: the one containing it with the latest head. */
export function foldContaining(ranges: readonly FoldRange[], line: number): FoldRange | null {
  let best: FoldRange | null = null;
  for (const r of ranges) {
    if (line > r.head && line < r.end && (!best || r.head > best.head)) best = r;
  }
  return best;
}

/** Every range whose fold would hide the line — outermost first — so a jump there can open them all. */
export function foldsHiding(ranges: readonly FoldRange[], folded: ReadonlySet<number>, line: number): FoldRange[] {
  return ranges.filter((r) => folded.has(r.head) && line > r.head && line < r.end).sort((a, b) => a.head - b.head);
}

/** The heads to remember for a set of folded lines, as the text stands. */
export function foldHeads(ranges: readonly FoldRange[], folded: ReadonlySet<number>): FoldHead[] {
  return ranges.filter((r) => folded.has(r.head)).map((r) => ({ line: r.head, kind: r.kind, depth: r.depth, text: r.text }));
}

/**
 * The folded heads for a text, from what was remembered of it. A remembered
 * line still heading the same kind of thing at the same depth with the same
 * words is that fold; otherwise the fold is moved to the one line that matches
 * kind, depth and words, and dropped when none or several do.
 */
export function restoreFolds(ranges: readonly FoldRange[], heads: readonly FoldHead[]): Set<number> {
  const out = new Set<number>();
  for (const h of heads) {
    const same = (r: FoldRange): boolean => r.kind === h.kind && r.depth === h.depth && r.text === h.text;
    const at = ranges.find((r) => r.head === h.line);
    if (at && same(at)) {
      out.add(at.head);
      continue;
    }
    const matches = ranges.filter(same);
    if (matches.length === 1) out.add(matches[0].head);
  }
  return out;
}

/** The store with one note's folds written, the oldest notes' forgotten past the cap, and a note with no folds taken out. */
export function withFolds(store: Record<string, NoteFolds>, noteId: string, heads: FoldHead[], now = Date.now()): Record<string, NoteFolds> {
  const next: Record<string, NoteFolds> = { ...store };
  if (heads.length === 0) delete next[noteId];
  else next[noteId] = { updatedAt: now, heads };
  const ids = Object.keys(next).sort((a, b) => next[a].updatedAt - next[b].updatedAt);
  while (ids.length > FOLDS_KEPT) delete next[ids.shift() as string];
  return next;
}

/** The store without the notes that are gone. */
export function pruneFolds(store: Record<string, NoteFolds>, exists: (id: string) => boolean): Record<string, NoteFolds> {
  const next: Record<string, NoteFolds> = {};
  for (const [id, folds] of Object.entries(store)) if (exists(id)) next[id] = folds;
  return next;
}

/** Folds as read from a store that may hold anything. */
export function parseFolds(raw: unknown): Record<string, NoteFolds> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, NoteFolds> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<NoteFolds>;
    const heads = Array.isArray(v.heads)
      ? v.heads.filter(
          (h): h is FoldHead =>
            !!h && typeof h === 'object' && Number.isInteger((h as FoldHead).line) && ((h as FoldHead).kind === 'heading' || (h as FoldHead).kind === 'list') && typeof (h as FoldHead).depth === 'number' && typeof (h as FoldHead).text === 'string',
        )
      : [];
    if (heads.length > 0) out[id] = { updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0, heads };
  }
  return out;
}
