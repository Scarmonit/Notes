import { assetNameFromUrl, assetUrl, isSafeAssetName } from '../shared/assets';
import { isFenceLine } from './fences';
import { LINK_PATTERN, linkMarkdown } from './notes';

/**
 * The editor is a contenteditable surface, not a textarea, so attached images
 * can render as actual pictures inline where they were pasted. The note is
 * still stored and exported as markdown: this module maps between the markdown
 * body and the DOM.
 *
 * Only our own attachments (note-asset:// images) become picture chips. Every
 * other character, including all other markdown syntax, stays literal text,
 * so the surface reads as a plain writing area with images in it.
 *
 * An image at its natural size is stored as `![alt](note-asset://name)`. One
 * the writer has resized is stored as an HTML tag, `<img src="note-asset://name"
 * alt="alt" width="320">`, since markdown has no width syntax and the tag
 * renders everywhere markdown does, width included.
 */

const NAME = '[a-f0-9]{8,32}\\.(?:png|jpe?g|gif|webp|bmp)';
// Either form of an attached image, a section rule (---, *** or ___ alone on a
// line, as markdown defines a horizontal rule), or a link to another note, in
// one pass over the body. A new kind goes on the end: imageTokens() filters
// this list, so the index of an image must not move when a kind is added.
const TOKEN = new RegExp(
  `!\\[([^\\]]*)\\]\\(note-asset:\\/\\/(${NAME})\\)|<img\\b([^<>]*)>|^[ \\t]{0,3}(-{3,}|\\*{3,}|_{3,})[ \\t]*$|${LINK_PATTERN}`,
  'gim',
);

/** The markdown written back for a section rule. */
export const RULE_MD = '---';

export const MIN_IMAGE_WIDTH = 48;

export interface ImageRef {
  name: string;
  alt: string;
  /** Display width in CSS pixels, or null for the natural size. */
  width: number | null;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decodeEntities = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrOf(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Parses an image token match into a reference, or null when it is not one of our attachments. */
function refOf(match: RegExpExecArray): ImageRef | null {
  if (match[2] !== undefined) return { name: match[2], alt: match[1], width: null };
  const attrs = match[3] ?? '';
  const name = assetNameFromUrl(attrOf(attrs, 'src') ?? '');
  if (!name) return null;
  const width = parseWidth(attrOf(attrs, 'width'));
  return { name, alt: attrOf(attrs, 'alt') ?? 'image', width };
}

function parseWidth(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= MIN_IMAGE_WIDTH ? n : null;
}

/** The markdown (or HTML, when sized) for one attached image. */
export function imageMarkdown(ref: ImageRef): string {
  if (ref.width === null) return `![${ref.alt}](${assetUrl(ref.name)})`;
  return `<img src="${assetUrl(ref.name)}" alt="${escapeAttr(ref.alt)}" width="${ref.width}">`;
}

/** Where a token sits in the body text. */
export interface Span {
  start: number;
  end: number;
}

export type BodyToken =
  | ({ kind: 'image' } & ImageRef & Span)
  | ({ kind: 'rule' } & Span)
  | ({ kind: 'link'; target: string } & Span);

/** Every image, section rule and note link in a body, in order, with the span of text each occupies. */
export function bodyTokens(body: string): BodyToken[] {
  const out: BodyToken[] = [];
  const fenced = fencedSpans(body);
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(body)) !== null) {
    const span = { start: match.index, end: match.index + match[0].length };
    // Inside a code fence it is the characters that were typed, as the preview shows them.
    if (fenced.some((f) => span.start >= f.start && span.start < f.end)) continue;
    if (match[4] !== undefined) {
      out.push({ kind: 'rule', ...span });
      continue;
    }
    if (match[5] !== undefined) {
      const target = match[5].trim();
      if (target) out.push({ kind: 'link', target, ...span });
      continue;
    }
    const ref = refOf(match);
    if (ref) out.push({ kind: 'image', ...ref, ...span });
  }
  return out;
}

/** The spans of fenced code blocks, fence lines included; an unclosed fence runs to the end. */
function fencedSpans(body: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let at = 0;
  let open = -1;
  for (const line of body.split('\n')) {
    if (isFenceLine(line)) {
      if (open < 0) open = at;
      else {
        out.push({ start: open, end: at + line.length });
        open = -1;
      }
    }
    at += line.length + 1;
  }
  if (open >= 0) out.push({ start: open, end: body.length });
  return out;
}

/** Every attached image in a body, in order, with the span of text each occupies. */
export function imageTokens(body: string): Array<ImageRef & { start: number; end: number }> {
  return bodyTokens(body).flatMap((t) => (t.kind === 'image' ? [t] : []));
}

/** The HTML for one section rule chip, for insertion at the caret. */
export function ruleHtml(): string {
  return '<hr class="inline-rule" contenteditable="false">';
}

/** A fresh section rule element. */
export function makeRule(): HTMLHRElement {
  const hr = document.createElement('hr');
  hr.className = 'inline-rule';
  hr.contentEditable = 'false';
  return hr;
}

export function isRule(node: unknown): node is HTMLHRElement {
  return node instanceof HTMLHRElement && node.classList.contains('inline-rule');
}

/**
 * A link to another note, drawn as a chip there is no writing inside. The
 * target lives in the dataset rather than in the visible text, so what gets
 * written back is the title the writer meant even if the chip is restyled.
 */
const LINK_CLASS = 'inline-link';

export function makeLink(target: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = LINK_CLASS;
  // The attribute rather than the property: the property does not always
  // reflect into the DOM, and the serializer reads what is actually there.
  span.setAttribute('contenteditable', 'false');
  span.dataset.link = target;
  span.textContent = target;
  span.title = `Go to “${target}”`;
  return span;
}

// Deliberately widened to HTMLElement: a span carries nothing an element does
// not, so narrowing on HTMLSpanElement would leave the other branch as never.
export function isLink(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement && node.classList.contains(LINK_CLASS);
}

/** The note title a link chip points at. */
export function linkTargetOf(node: HTMLElement): string {
  return (node.dataset.link ?? node.textContent ?? '').trim();
}

/** The HTML for one inline image chip, for insertion at the caret. */
export function imageChipHtml(name: string, alt: string): string {
  const a = escapeAttr(alt || 'image');
  return `<img class="inline-img" contenteditable="false" draggable="true" src="${assetUrl(name)}" alt="${a}" data-asset="${name}" data-alt="${a}">`;
}

function makeChip(ref: ImageRef): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'inline-img';
  img.contentEditable = 'false';
  img.draggable = true;
  img.src = assetUrl(ref.name);
  img.alt = ref.alt || 'image';
  img.dataset.asset = ref.name;
  img.dataset.alt = ref.alt || 'image';
  setChipWidth(img, ref.width);
  return img;
}

/** Sets a chip's display width, or restores its natural size with null. */
export function setChipWidth(img: HTMLImageElement, width: number | null): void {
  if (width === null) {
    img.removeAttribute('width');
    img.style.removeProperty('width');
    return;
  }
  const w = Math.max(MIN_IMAGE_WIDTH, Math.round(width));
  img.setAttribute('width', String(w));
  img.style.width = `${w}px`;
}

export function chipWidth(img: HTMLImageElement): number | null {
  return parseWidth(img.getAttribute('width'));
}

export function isChip(node: unknown): node is HTMLImageElement {
  return node instanceof HTMLImageElement && node.classList.contains('inline-img');
}

/** The image chips in the editor, in document order. */
export function chipsOf(root: HTMLElement): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>('img.inline-img'));
}

/** The class of the element each render puts the note's DOM inside. */
const DOC_CLASS = 'doc';

/**
 * The element the note's DOM lives in: a wrapper made fresh for every render,
 * or the root itself when the wrapper has gone. A fresh wrapper is what makes
 * a render a clean break for undo — the browser's undo entries hold on to the
 * nodes they changed, and once those nodes are the old wrapper's they can no
 * longer reach the editor. Without it, undo after switching notes could pull
 * the previous note's text into this one.
 */
export function docOf(root: HTMLElement): HTMLElement {
  const first = root.firstElementChild;
  return root.childNodes.length === 1 && first instanceof HTMLElement && first.classList.contains(DOC_CLASS) ? first : root;
}

/** Replaces the editor's contents with the DOM for `body`. Call on note switch. */
export function renderEditor(root: HTMLElement, body: string): void {
  const doc = document.createElement('div');
  doc.className = DOC_CLASS;
  let last = 0;
  for (const tok of bodyTokens(body)) {
    if (tok.start > last) doc.appendChild(document.createTextNode(body.slice(last, tok.start)));
    doc.appendChild(tok.kind === 'rule' ? makeRule() : tok.kind === 'link' ? makeLink(tok.target) : makeChip(tok));
    last = tok.end;
  }
  if (last < body.length) doc.appendChild(document.createTextNode(body.slice(last)));
  // An empty element has no place for a caret, so the browser would type
  // beside the wrapper rather than in it; a <br> is its own idiom for an empty
  // editable line, and the serializer reads it as nothing.
  if (doc.childNodes.length === 0) doc.appendChild(document.createElement('br'));
  root.replaceChildren(doc);
  markEmpty(root);
}

// --- reading the DOM --------------------------------------------------------

export interface DomPos {
  node: Node;
  offset: number;
}

/** Where one markdown line starts and ends in the editor DOM. */
export interface LineSpan {
  start: DomPos;
  end: DomPos;
}

/**
 * One run of the markdown text and the DOM it came from: a text node, or a
 * single node — a chip, a <br>, the edge of a browser-made line — that
 * stands for a run of characters. Together they map any offset in the text
 * to a place in the DOM, which is how find paints a match and how the caret
 * is put back after a line is redrawn.
 */
export interface Segment {
  /** A text node with offset 0, or the parent of a block node with its child index. */
  node: Node;
  offset: number;
  /** Where in the text the run starts, and how many characters it covers. */
  at: number;
  length: number;
  kind: 'text' | 'block';
  /** Text inside a formatting wrapper, which a caret placed by the app should keep out of. */
  wrapped: boolean;
}

export interface Analysis {
  /** The markdown body, exactly as serializeEditor returns it. */
  text: string;
  /** One span per line of `text`. */
  lines: LineSpan[];
  /** Every run of `text`, in order. */
  segments: Segment[];
}

const indexIn = (node: Node): number => Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);

/** The class live formatting gives its wrappers; the walker treats them as transparent. */
const FORMAT_PREFIX = 'md-';

const isFormatWrapper = (elm: Element): boolean => Array.from(elm.classList).some((c) => c.startsWith(FORMAT_PREFIX));

/**
 * Walks the editor once, producing the markdown text and, for every line of
 * it, the DOM positions it starts and ends at. The two are computed together
 * so they can never disagree about where a line break falls: a break is a
 * newline character in a text node, a <br>, or the edge of a browser-made
 * <div> line.
 */
function analyze(root: HTMLElement, keepTrailing = false): Analysis {
  let out = '';
  const lines: LineSpan[] = [];
  const segments: Segment[] = [];
  const base = docOf(root);
  let start: DomPos = { node: base, offset: 0 };
  const breakAt = (end: DomPos, next: DomPos): void => {
    lines.push({ start, end });
    start = next;
    out += '\n';
  };
  const block = (elm: HTMLElement, length: number, wrapped: boolean): void => {
    segments.push({ node: elm.parentNode as Node, offset: indexIn(elm), at: out.length, length, kind: 'block', wrapped });
  };
  const walk = (node: Node, wrapped: boolean): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        segments.push({ node: child, offset: 0, at: out.length, length: text.length, kind: 'text', wrapped });
        let from = 0;
        for (;;) {
          const nl = text.indexOf('\n', from);
          if (nl < 0) break;
          out += text.slice(from, nl);
          breakAt({ node: child, offset: nl }, { node: child, offset: nl + 1 });
          from = nl + 1;
        }
        out += text.slice(from);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const elm = child as HTMLElement;
      // A link chip is a span, and a span is also what the browser makes on
      // its own, so it is recognised by its class before its tag is looked at.
      if (elm.classList.contains(LINK_CLASS)) {
        const md = linkMarkdown(linkTargetOf(elm));
        block(elm, md.length, wrapped);
        out += md;
        return;
      }
      switch (elm.tagName) {
        case 'IMG': {
          const name = elm.dataset.asset ?? assetNameFromUrl(elm.getAttribute('src') ?? '');
          if (name && isSafeAssetName(name)) {
            const alt = elm.dataset.alt ?? elm.getAttribute('alt') ?? 'image';
            const md = imageMarkdown({ name, alt, width: parseWidth(elm.getAttribute('width')) });
            block(elm, md.length, wrapped);
            out += md;
          }
          break;
        }
        case 'HR':
          block(elm, RULE_MD.length, wrapped);
          out += RULE_MD;
          break;
        case 'BR': {
          const i = indexIn(elm);
          block(elm, 1, wrapped);
          breakAt({ node: elm.parentNode as Node, offset: i }, { node: elm.parentNode as Node, offset: i + 1 });
          break;
        }
        case 'DIV':
        case 'P':
          // A browser-created line: start it on a new line, then descend.
          if (out.length > 0 && !out.endsWith('\n')) {
            block(elm, 1, wrapped);
            breakAt({ node: elm.parentNode as Node, offset: indexIn(elm) }, { node: elm, offset: 0 });
          }
          walk(elm, wrapped);
          break;
        default:
          walk(elm, wrapped || isFormatWrapper(elm));
      }
    });
  };
  walk(root, false);
  lines.push({ start, end: { node: base, offset: base.childNodes.length } });
  // A contenteditable keeps a trailing <br> to make the last line visible;
  // that shows up as one extra newline, which is not part of the text.
  if (!keepTrailing && out.endsWith('\n')) {
    out = out.slice(0, -1);
    lines.pop();
  }
  return { text: out, lines, segments };
}

/**
 * The DOM position for an offset in the text. On a boundary between runs
 * there is more than one answer; the one chosen is inside a text node rather
 * than beside a block, and outside a formatting wrapper rather than inside
 * one, so that typing there lands in plain text and not in the bold word
 * just finished.
 */
export function posAt(segments: Segment[], offset: number): DomPos | null {
  let best: { rank: number; pos: DomPos } | null = null;
  for (const seg of segments) {
    if (offset < seg.at || offset > seg.at + seg.length) continue;
    let rank: number;
    let pos: DomPos;
    if (seg.kind === 'text') {
      const inside = offset < seg.at + seg.length;
      // Plain text first, whether inside or at its end; wrapped text only then.
      rank = (seg.wrapped ? 2 : 0) + (inside ? 0 : 1);
      pos = { node: seg.node, offset: offset - seg.at };
    } else {
      rank = 4;
      pos = { node: seg.node, offset: seg.offset + (offset === seg.at ? 0 : 1) };
    }
    if (!best || rank < best.rank) best = { rank, pos };
  }
  if (best) return best.pos;
  const last = segments[segments.length - 1];
  return last ? { node: last.node, offset: last.kind === 'text' ? last.length : last.offset + 1 } : null;
}

/** A range over the text between two offsets. */
export function rangeBetween(root: HTMLElement, segments: Segment[], start: number, end: number): Range | null {
  const from = posAt(segments, start) ?? { node: root, offset: 0 };
  const to = posAt(segments, end) ?? from;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range;
}

/** How far into the text a DOM position is: the length of everything before it. */
export function offsetOf(root: HTMLElement, pos: DomPos): number {
  return textBefore(root, pos).length;
}

/** Reads the editor's DOM back out as a markdown body. */
export function serializeEditor(root: HTMLElement): string {
  return analyze(root).text;
}

/**
 * The body and its line map from a single walk. Callers that need both — the
 * focus dimmer, the checkbox shortcut — should use this rather than calling
 * serializeEditor and lineSpans, which would walk the DOM twice on every
 * caret move.
 */
export function readEditor(root: HTMLElement): Analysis {
  return analyze(root);
}

/** The markdown from the start of the editor up to a DOM position, trailing newlines kept. */
export function textBefore(root: HTMLElement, pos: DomPos): string {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(pos.node, pos.offset);
  return textOfRange(range);
}

/** The markdown a range of the editor covers — what copying it should put on the clipboard. */
export function textOfRange(range: Range): string {
  const holder = document.createElement('div');
  holder.append(range.cloneContents());
  return analyze(holder, true).text;
}

/** The DOM span of each markdown line, in order. */
export function lineSpans(root: HTMLElement): LineSpan[] {
  return analyze(root).lines;
}

/** Which markdown line a DOM position falls on. */
export function lineIndexAt(root: HTMLElement, pos: DomPos): number {
  return lineIndexIn(lineSpans(root), pos);
}

/** The same, when the line spans are already in hand. */
export function lineIndexIn(spans: LineSpan[], pos: DomPos): number {
  let index = 0;
  for (let i = 1; i < spans.length; i++) {
    const r = document.createRange();
    r.setStart(spans[i].start.node, spans[i].start.offset);
    r.collapse(true);
    if (r.comparePoint(pos.node, pos.offset) >= 0) index = i;
    else break;
  }
  return index;
}

/**
 * The block of lines the caret's line belongs to: everything up to the blank
 * lines on either side, which is what a writer means by "this paragraph".
 * A blank line is its own paragraph, so the dimming does not jump around while
 * pressing Enter between blocks.
 */
export function paragraphBounds(lines: string[], line: number): { first: number; last: number } {
  const at = Math.max(0, Math.min(lines.length - 1, line));
  if (lines.length === 0) return { first: 0, last: 0 };
  if ((lines[at] ?? '').trim() === '') return { first: at, last: at };
  let first = at;
  let last = at;
  while (first > 0 && lines[first - 1].trim() !== '') first--;
  while (last < lines.length - 1 && lines[last + 1].trim() !== '') last++;
  return { first, last };
}

/** Toggles the empty flag that drives the placeholder. */
export function markEmpty(root: HTMLElement): void {
  root.classList.toggle('is-empty', serializeEditor(root) === '');
}

// --- moving an image between lines -----------------------------------------

/**
 * Lifts the `index`-th attached image out of wherever it sits and gives it a
 * line of its own at `targetLine` (counted before the lift). A line left empty
 * by the lift goes away, so the note does not gather blank lines as pictures
 * move around. Returns the new body and the image's new index.
 */
export function moveImageToLine(body: string, index: number, targetLine: number): { body: string; index: number } {
  const tokens = imageTokens(body);
  const tok = tokens[index];
  if (!tok) return { body, index };
  const lines = body.split('\n');
  const lineStarts: number[] = [];
  for (let at = 0, i = 0; i < lines.length; i++) {
    lineStarts.push(at);
    at += lines[i].length + 1;
  }
  let from = 0;
  while (from + 1 < lineStarts.length && lineStarts[from + 1] <= tok.start) from++;
  const line = lines[from];
  const col = tok.start - lineStarts[from];
  const rest = line.slice(0, col) + line.slice(col + (tok.end - tok.start));
  let target = Math.max(0, Math.min(lines.length, targetLine));
  if (rest.trim() === '') {
    lines.splice(from, 1);
    if (target > from) target--;
  } else {
    lines[from] = rest;
  }
  const token = body.slice(tok.start, tok.end);
  lines.splice(target, 0, token);
  const next = lines.join('\n');
  const at = lines.slice(0, target).reduce((n, l) => n + l.length + 1, 0);
  const newIndex = imageTokens(next).findIndex((t) => t.start === at);
  return { body: next, index: newIndex < 0 ? index : newIndex };
}

/** The line an image token sits on. */
export function imageLine(body: string, index: number): number {
  const tok = imageTokens(body)[index];
  if (!tok) return -1;
  return body.slice(0, tok.start).split('\n').length - 1;
}

/** Moves an image one line up or down. */
export function moveImageBy(body: string, index: number, delta: -1 | 1): { body: string; index: number } {
  const line = imageLine(body, index);
  if (line < 0) return { body, index };
  const tok = imageTokens(body)[index];
  const own = body.split('\n')[line].trim() === body.slice(tok.start, tok.end);
  // Alone on its line: swap with the neighbour. Sharing a line: step out onto
  // a line of its own just above or below.
  const target = delta < 0 ? (own ? line - 1 : line) : own ? line + 2 : line + 1;
  if (target < 0) return { body, index };
  return moveImageToLine(body, index, target);
}
