import { calloutHead, QUOTE_PREFIX } from '../shared/callouts';
import { isFenceLine } from './fences';

/**
 * Live formatting: markdown drawn as what it means, while the characters
 * stay exactly what was typed. Each line of the body becomes HTML in which
 * runs of the text are wrapped in spans — a heading, a bold word, a code
 * span — and the markers that made them so are wrapped too, so they can be
 * faded or hidden. Nothing is added to or taken from the text: the HTML's
 * text content is the line, and the editor's serializer, which reads text
 * and ignores wrappers, gets the markdown back unchanged.
 *
 * Pure string work, so it can be tested alone; putting the HTML into the
 * editor, and keeping the caret while doing it, is main.ts's job.
 */

/** A span of the line that is a chip (an image, a rule, a note link) and must be left to the editor. */
export interface Protected {
  start: number;
  end: number;
}

/** Stands in for a chip in the HTML; the editor swaps the real element back in. */
export const CHIP_PLACEHOLDER = '<!--chip-->';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = (s: string): string => (s ? `<span class="md-mark">${esc(s)}</span>` : '');

// Inline forms, tried left to right at every position. Order matters where
// two could start at the same character: a code span wins over everything
// inside it, and ** is looked at before *.
const INLINE = new RegExp(
  [
    '(?<code>`[^`\\n]+`)',
    '(?<strong>\\*\\*(?=\\S)[\\s\\S]+?(?<=\\S)\\*\\*|__(?=\\S)[\\s\\S]+?(?<=\\S)__)',
    '(?<strike>~~(?=\\S)[\\s\\S]+?(?<=\\S)~~)',
    '(?<em>(?<![\\w*])\\*(?=[^\\s*])[^*\\n]+?(?<=[^\\s*])\\*(?![\\w*])|(?<![\\w_])_(?=[^\\s_])[^_\\n]+?(?<=[^\\s_])_(?![\\w_]))',
    // A footnote written where it is referred to: `^[words]`, one level of
    // brackets inside allowed, so a `[[link]]` in the note still reads.
    '(?<fninline>(?<!\\\\)\\^\\[(?:\\\\.|\\[(?:\\[[^\\[\\]\\n]*\\]|[^\\[\\]\\n])*\\]|[^\\[\\]\\n])+\\])',
    '(?<link>\\[[^\\]\\n]+\\]\\([^)\\n]*\\))',
    // A footnote reference, `[^id]`; a `[^id]:` is a definition, handled per line.
    '(?<fnref>(?<!\\\\)\\[\\^[^\\s\\[\\]]+\\](?!:))',
    '(?<tag>(?<![^\\s])#\\p{L}[\\p{L}\\p{N}_-]*(?:\\/[\\p{L}\\p{N}_-]+)*)',
    // A block address at the end of a line. Faded like every other marker and
    // never hidden: a marker Chromium's delete can skip over survives as
    // stray characters, which is the trap live formatting hit in 0.11.0.
    '(?<block>(?<=\\s)\\^[A-Za-z0-9][A-Za-z0-9-]*[ \\t]*$)',
  ].join('|'),
  'gu',
);

const MAX_DEPTH = 2;

/** Inline markdown as HTML: emphasis, code, links and tags, with their markers wrapped. */
export function inlineHtml(text: string, depth = 0): string {
  if (depth >= MAX_DEPTH) return esc(text);
  let out = '';
  let at = 0;
  // matchAll works on its own copy of the pattern, so the recursion below
  // cannot disturb this loop's place in the text.
  for (const m of text.matchAll(INLINE)) {
    out += esc(text.slice(at, m.index));
    const g = m.groups ?? {};
    const raw = m[0];
    if (g.code !== undefined) {
      out += `<span class="md-code">${mark('`')}${esc(raw.slice(1, -1))}${mark('`')}</span>`;
    } else if (g.strong !== undefined) {
      const d = raw.slice(0, 2);
      out += `<span class="md-strong">${mark(d)}${inlineHtml(raw.slice(2, -2), depth + 1)}${mark(d)}</span>`;
    } else if (g.strike !== undefined) {
      out += `<span class="md-strike">${mark('~~')}${inlineHtml(raw.slice(2, -2), depth + 1)}${mark('~~')}</span>`;
    } else if (g.em !== undefined) {
      const d = raw[0];
      out += `<span class="md-em">${mark(d)}${inlineHtml(raw.slice(1, -1), depth + 1)}${mark(d)}</span>`;
    } else if (g.link !== undefined) {
      const close = raw.indexOf('](');
      out += `<span class="md-link">${mark('[')}${inlineHtml(raw.slice(1, close), depth + 1)}${mark(raw.slice(close))}</span>`;
    } else if (g.fninline !== undefined) {
      out += `<span class="md-fninline">${mark('^[')}${inlineHtml(raw.slice(2, -1), depth + 1)}${mark(']')}</span>`;
    } else if (g.fnref !== undefined) {
      out += `<span class="md-fnref">${mark('[^')}<span class="md-fnid">${esc(raw.slice(2, -1))}</span>${mark(']')}</span>`;
    } else if (g.block !== undefined) {
      out += `<span class="md-block">${mark(raw)}</span>`;
    } else {
      out += `<span class="md-tag">${esc(raw)}</span>`;
    }
    at = m.index + raw.length;
  }
  return out + esc(text.slice(at));
}

/** Inline HTML for a line that may hold chips: the text between them is formatted, the chips stand in. */
function inlineWithChips(text: string, chips: Protected[], offset: number): string {
  let out = '';
  let at = 0;
  for (const chip of chips) {
    const start = chip.start - offset;
    const end = chip.end - offset;
    if (start < at || end > text.length) continue;
    out += inlineHtml(text.slice(at, start)) + CHIP_PLACEHOLDER;
    at = end;
  }
  return out + inlineHtml(text.slice(at));
}

/** The same line, text only, for lines nothing is formatted in. */
function plainWithChips(text: string, chips: Protected[]): string {
  let out = '';
  let at = 0;
  for (const chip of chips) {
    if (chip.start < at || chip.end > text.length) continue;
    out += esc(text.slice(at, chip.start)) + CHIP_PLACEHOLDER;
    at = chip.end;
  }
  return out + esc(text.slice(at));
}

const HEADING = /^([ \t]{0,3}#{1,6}[ \t]+)([\s\S]*)$/;
const QUOTE = /^([ \t]*>[ \t]?)([\s\S]*)$/;
const LIST = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)([\s\S]*)$/;
const TASK = /^(\[([ xX])\][ \t]+)([\s\S]*)$/;
// A footnote's definition: `[^id]:` at the start of the line, then its words.
const FNDEF = /^([ ]{0,3}\[\^[^\s[\]]+\]:[ \t]?)([\s\S]*)$/;
// The head of a callout, after the quote marker: `[!type]`, a fold sign, a title.
const CALLOUT_TYPE = /^(\[![A-Za-z][A-Za-z0-9_-]*\][+-]?)((?:[ \t]+[\s\S]*)?)$/;

/** Where a line stands in a callout, worked out over the whole body by decorateLines. */
export type CalloutPart = 'head' | 'body' | null;

/** Whether a line heads something that can fold, and whether it is folded now; worked out by the editor. */
export type FoldHint = 'foldable' | 'folded' | null;

/** The classes and state a fold hint puts on a head line's first wrapper. */
const foldAttrs = (fold: FoldHint): string => (fold ? ` md-foldable${fold === 'folded' ? ' md-folded' : ''}" data-fold="${fold === 'folded' ? 'closed' : 'open'}"` : '"');

/**
 * One line as HTML. `inFence` says whether the line sits inside a code
 * block, where nothing is markdown; `chips` are the spans of the line the
 * editor draws itself; `callout` says whether the line begins or continues a
 * callout, which only a pass over the lines around it can know.
 */
export function decorateLine(line: string, inFence: boolean, chips: Protected[] = [], callout: CalloutPart = null, fold: FoldHint = null): string {
  if (line === '') return '';
  if (isFenceLine(line)) return `<span class="md-fence">${plainWithChips(line, chips)}</span>`;
  if (inFence) return `<span class="md-codeline">${plainWithChips(line, chips)}</span>`;
  // A line that is nothing but chips — a picture, a rule — is left alone.
  if (chips.length > 0 && chips[0].start === 0 && chips[chips.length - 1].end === line.length && chips.length === 1) return CHIP_PLACEHOLDER;

  const heading = HEADING.exec(line);
  if (heading) {
    const level = heading[1].trim().length;
    return `<span class="md-h md-h${level}${foldAttrs(fold)}>${mark(heading[1])}${inlineWithChips(heading[2], chips, heading[1].length)}</span>`;
  }
  const quote = QUOTE.exec(line);
  if (quote) {
    const cls = callout ? ` md-callout md-callout-${callout}` : '';
    const head = callout === 'head' ? CALLOUT_TYPE.exec(quote[2]) : null;
    if (head) {
      // The type is the label the box wears, so it stays legible; only the quote marker fades.
      const at = quote[1].length + head[1].length;
      return `<span class="md-quote${cls}">${mark(quote[1])}<span class="md-callout-type">${esc(head[1])}</span>${inlineWithChips(head[2], chips, at)}</span>`;
    }
    return `<span class="md-quote${cls}">${mark(quote[1])}${inlineWithChips(quote[2], chips, quote[1].length)}</span>`;
  }
  const fndef = FNDEF.exec(line);
  if (fndef) {
    return `<span class="md-fndef"><span class="md-fnlabel">${esc(fndef[1])}</span>${inlineWithChips(fndef[2], chips, fndef[1].length)}</span>`;
  }
  const list = LIST.exec(line);
  if (list) {
    const bullet = `<span class="md-bullet${foldAttrs(fold)}>${esc(list[1])}</span>`;
    const task = TASK.exec(list[2]);
    if (task) {
      const offset = list[1].length + task[1].length;
      const rest = inlineWithChips(task[3], chips, offset);
      return `${bullet}${mark(task[1])}${task[2] === ' ' ? rest : `<span class="md-done">${rest}</span>`}`;
    }
    return `${bullet}${inlineWithChips(list[2], chips, list[1].length)}`;
  }
  return inlineWithChips(line, chips, 0);
}

/**
 * Every line of a body as HTML, with code fences tracked from line to line
 * so the lines inside one are drawn as code rather than parsed as markdown.
 */
export function decorateLines(lines: string[], chips: Protected[][] = [], folds: FoldHint[] = []): string[] {
  let inFence = false;
  const parts = calloutParts(lines);
  return lines.map((line, i) => {
    const html = decorateLine(line, inFence, chips[i] ?? [], parts[i], folds[i] ?? null);
    if (isFenceLine(line)) inFence = !inFence;
    return html;
  });
}

/** How deep in quotes a line is: the number of `>` markers that open it. */
function quoteDepth(line: string): number {
  let depth = 0;
  let rest = line;
  for (;;) {
    const m = QUOTE_PREFIX.exec(rest);
    if (!m) return depth;
    depth++;
    rest = rest.slice(m[0].length);
  }
}

/** The text of a quoted line past `depth` markers. */
function unquote(line: string, depth: number): string {
  let rest = line;
  for (let i = 0; i < depth; i++) rest = rest.replace(QUOTE_PREFIX, '');
  return rest;
}

/**
 * Which lines are callouts. A `> [!type]` line at some depth begins one, and
 * every following line quoted at least that deep continues it; the callout
 * ends at the first line that is not, or at a fence. Nested callouts are
 * callouts too, so a line inside one is marked as a body line whichever
 * callout it is inside — the box is drawn the same at every depth.
 */
export function calloutParts(lines: readonly string[]): CalloutPart[] {
  const out: CalloutPart[] = new Array(lines.length).fill(null);
  let inFence = false;
  // The depths of the callouts open at this line, innermost last.
  let open: number[] = [];
  lines.forEach((line, i) => {
    if (isFenceLine(line)) {
      inFence = !inFence;
      open = [];
      return;
    }
    if (inFence) return;
    const depth = quoteDepth(line);
    if (depth === 0) {
      open = [];
      return;
    }
    open = open.filter((d) => depth >= d);
    // The innermost quote on this line may itself open a callout.
    if (calloutHead(unquote(line, depth)) && !open.includes(depth)) {
      open.push(depth);
      out[i] = 'head';
      return;
    }
    if (open.length > 0) out[i] = 'body';
  });
  return out;
}

/** Whether a line's HTML is more than its text: something on it is formatted. */
export const isDecorated = (html: string): boolean => html.includes('<span') || html.includes(CHIP_PLACEHOLDER);
