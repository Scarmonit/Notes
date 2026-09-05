/**
 * Footnotes, as text: where the references, the definitions and the inline
 * notes are in a markdown body, and how they are numbered. The markdown core
 * renders from this, live formatting shapes from this, and the rail beside the
 * page lists and rewrites from this, so the three cannot count differently.
 *
 * The syntax is Obsidian's and Typora's: `[^id]` refers, `[^id]: words` on a
 * line of its own defines (with continuation lines indented four spaces or a
 * tab), and `^[words]` is a footnote written where it is referred to. Numbers
 * are given in order of first reference, 1 upward, whatever the ids say; every
 * inline note is an entry of its own. Nothing inside a code fence or a code
 * span counts, and a bracket escaped with a backslash is the character.
 */

export interface FootnoteDef {
  id: string;
  /** The definition's markdown, continuation lines de-indented, no trailing blank lines. */
  text: string;
  /** Its first line, counted from 0. */
  start: number;
  /** One past its last line. */
  end: number;
}

export interface FootnoteRef {
  id: string;
  line: number;
  /** Where `[^` starts on the line. */
  col: number;
  /** One past the closing bracket. */
  endCol: number;
}

export interface InlineNote {
  /** The words inside `^[` … `]`, exactly as written. */
  text: string;
  line: number;
  col: number;
  endCol: number;
}

/** One numbered footnote as rendered: a defined id, or an inline note. */
export type FootnoteEntry =
  | { kind: 'named'; number: number; id: string; def: FootnoteDef; refs: FootnoteRef[] }
  | { kind: 'inline'; number: number; note: InlineNote };

export interface FootnoteScan {
  /** The definition that counts for each id: the first one written. */
  defs: FootnoteDef[];
  /** Definitions of an id already defined; they stay in the text as they are. */
  duplicates: FootnoteDef[];
  /** Every `[^id]` in source order, whether or not it is defined. */
  refs: FootnoteRef[];
  inlines: InlineNote[];
  /** The numbered footnotes, in the order they are numbered. */
  entries: FootnoteEntry[];
  /** Ids referred to that no definition answers, in first-occurrence order. */
  undefined: string[];
  /** Definitions nothing refers to, in source order. */
  unreferenced: FootnoteDef[];
}

const DEF = /^ {0,3}\[\^([^\s[\]]+)\]:(?:[ \t]+(.*)|[ \t]*)$/;
const CONTINUATION = /^(?: {4}|\t)(.*)$/;
const FENCE = /^ {0,3}(```+|~~~+)/;
const REF = /\[\^([^\s[\]]+)\](?!:)/g;

/** A line with its code spans blanked, so brackets inside backticks are not read. */
function withoutCode(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
}

const escaped = (line: string, at: number): boolean => {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && line[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
};

/** The inline notes on one line: `^[` to its balanced `]`, escapes honoured. */
export function inlineNotesOn(line: string, lineNo: number): InlineNote[] {
  const out: InlineNote[] = [];
  const masked = withoutCode(line);
  for (let i = 0; i + 1 < masked.length; i++) {
    if (masked[i] !== '^' || masked[i + 1] !== '[' || escaped(masked, i)) continue;
    let depth = 0;
    let end = -1;
    for (let j = i + 1; j < masked.length; j++) {
      if (masked[j] === '\\') {
        j++;
        continue;
      }
      if (masked[j] === '[') depth++;
      else if (masked[j] === ']') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) continue;
    const text = line.slice(i + 2, end);
    if (text.trim()) out.push({ text, line: lineNo, col: i, endCol: end + 1 });
    i = end;
  }
  return out;
}

/** The named references on one line. */
export function refsOn(line: string, lineNo: number): FootnoteRef[] {
  const out: FootnoteRef[] = [];
  const masked = withoutCode(line);
  for (const m of masked.matchAll(REF)) {
    if (escaped(masked, m.index)) continue;
    out.push({ id: m[1], line: lineNo, col: m.index, endCol: m.index + m[0].length });
  }
  return out;
}

/** Everything footnote-shaped in a body. */
export function scanFootnotes(body: string): FootnoteScan {
  const lines = body.split('\n');
  const defs: FootnoteDef[] = [];
  const duplicates: FootnoteDef[] = [];
  const refs: FootnoteRef[] = [];
  const inlines: InlineNote[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const def = DEF.exec(line);
    if (def) {
      const parts = [def[2] ?? ''];
      let end = i + 1;
      // Continuation: indented lines, and blank lines that an indented line follows.
      while (end < lines.length) {
        const c = CONTINUATION.exec(lines[end]);
        if (c) {
          parts.push(c[1]);
          end++;
          continue;
        }
        if (lines[end].trim() === '' && end + 1 < lines.length && CONTINUATION.test(lines[end + 1])) {
          parts.push('');
          end++;
          continue;
        }
        break;
      }
      const made: FootnoteDef = { id: def[1], text: parts.join('\n').replace(/\s+$/, ''), start: i, end };
      (defs.some((d) => d.id === made.id) ? duplicates : defs).push(made);
      // The definition's own words may refer to other footnotes.
      for (let k = i; k < end; k++) {
        refs.push(...refsOn(lines[k], k));
        inlines.push(...inlineNotesOn(lines[k], k));
      }
      i = end - 1;
      continue;
    }
    refs.push(...refsOn(line, i));
    inlines.push(...inlineNotesOn(line, i));
  }
  // Numbering: walk references and inline notes together in source order.
  const marks = [...refs.map((r) => ({ at: [r.line, r.col], ref: r, note: null as InlineNote | null })), ...inlines.map((n) => ({ at: [n.line, n.col], ref: null as FootnoteRef | null, note: n }))].sort(
    (a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1],
  );
  const entries: FootnoteEntry[] = [];
  const byId = new Map<string, FootnoteEntry & { kind: 'named' }>();
  const missing: string[] = [];
  for (const m of marks) {
    if (m.note) {
      entries.push({ kind: 'inline', number: entries.length + 1, note: m.note });
      continue;
    }
    const ref = m.ref as FootnoteRef;
    const had = byId.get(ref.id);
    if (had) {
      had.refs.push(ref);
      continue;
    }
    const def = defs.find((d) => d.id === ref.id);
    if (!def) {
      if (!missing.includes(ref.id)) missing.push(ref.id);
      continue;
    }
    const entry: FootnoteEntry & { kind: 'named' } = { kind: 'named', number: entries.length + 1, id: ref.id, def, refs: [ref] };
    byId.set(ref.id, entry);
    entries.push(entry);
  }
  const unreferenced = defs.filter((d) => !byId.has(d.id));
  return { defs, duplicates, refs, inlines, entries, undefined: missing, unreferenced };
}

/** The entry a reference on a line belongs to, or null for an undefined one. */
export function entryForRef(scan: FootnoteScan, id: string): (FootnoteEntry & { kind: 'named' }) | null {
  const found = scan.entries.find((e) => e.kind === 'named' && e.id === id);
  return (found as (FootnoteEntry & { kind: 'named' }) | undefined) ?? null;
}

/** The next numeric id: one above the largest positive number in use, or 1. */
export function nextFootnoteId(body: string): string {
  const scan = scanFootnotes(body);
  let max = 0;
  for (const id of [...scan.defs.map((d) => d.id), ...scan.duplicates.map((d) => d.id), ...scan.refs.map((r) => r.id)]) {
    if (/^\d+$/.test(id)) max = Math.max(max, Number(id));
  }
  return String(max + 1);
}

/**
 * A body with the text of one definition replaced. Continuation lines are
 * written back with four spaces, the way they were read; an empty text keeps
 * the `[^id]:` so the footnote is still there to be written.
 */
export function withDefinitionText(body: string, def: FootnoteDef, text: string): string {
  const lines = body.split('\n');
  const parts = text.replace(/\s+$/, '').split('\n');
  const made = [`[^${def.id}]:${parts[0] ? ` ${parts[0]}` : ''}`, ...parts.slice(1).map((l) => (l === '' ? '' : `    ${l}`))];
  lines.splice(def.start, def.end - def.start, ...made);
  return lines.join('\n');
}

/** A body with the words of one inline note replaced. */
export function withInlineText(body: string, note: InlineNote, text: string): string {
  const lines = body.split('\n');
  const line = lines[note.line] ?? '';
  const clean = text.replace(/\n+/g, ' ');
  lines[note.line] = `${line.slice(0, note.col)}^[${clean}]${line.slice(note.endCol)}`;
  return lines.join('\n');
}

/** A body with `[^id]: ` appended on its own, blank-line separated; the caret belongs after the space. */
export function withNewDefinition(body: string, id: string): { body: string; at: number } {
  const trimmed = body.replace(/\s+$/, '');
  const head = trimmed === '' ? '' : `${trimmed}\n\n`;
  const made = `${head}[^${id}]: `;
  return { body: made, at: made.length };
}
