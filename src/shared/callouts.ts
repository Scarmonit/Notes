/**
 * Callouts: a blockquote whose first line names what kind of aside it is,
 * `> [!info] Title`, in the syntax Obsidian settled on. This module knows the
 * syntax and the thirteen kinds with their aliases; the markdown core draws
 * them in the preview and every export, and live formatting shapes them in
 * the editor. Neither adds a colour: every kind is the same quiet box with a
 * different word on it, because the app has one accent and it is spent.
 */

export interface CalloutHead {
  /** The canonical kind, `info` for `[!INFO]` and for `[!foo]` alike. */
  kind: string;
  /** What the label says: `Info`, or `Foo` for a kind nobody defined. */
  label: string;
  /** `-` starts folded, `+` starts open and foldable, nothing means not foldable. */
  fold: '-' | '+' | null;
  /** The words after the type on the same line, or empty. */
  title: string;
}

const CANONICAL: Record<string, string> = {
  note: 'Note',
  abstract: 'Abstract',
  info: 'Info',
  todo: 'Todo',
  tip: 'Tip',
  success: 'Success',
  question: 'Question',
  warning: 'Warning',
  failure: 'Failure',
  danger: 'Danger',
  bug: 'Bug',
  example: 'Example',
  quote: 'Quote',
};

const ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

/** The thirteen kinds, canonical spelling, in Obsidian's order. */
export const CALLOUT_KINDS = Object.keys(CANONICAL);

/** The first line of a callout, after its `>`: `[!type]`, an optional `+`/`-`, an optional title. */
export const CALLOUT_HEAD = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?)(?:[ \t]+([^\n]*?))?[ \t]*$/;

/** Reads a callout's first line (the text after `> `), or null when it is an ordinary quote. */
export function calloutHead(text: string): CalloutHead | null {
  const m = CALLOUT_HEAD.exec(text);
  if (!m) return null;
  const typed = m[1];
  const lower = typed.toLowerCase();
  const kind = CANONICAL[lower] ? lower : (ALIASES[lower] ?? 'note');
  const known = CANONICAL[lower] !== undefined || ALIASES[lower] !== undefined;
  const label = known ? CANONICAL[kind] : typed.charAt(0).toUpperCase() + typed.slice(1);
  return { kind, label, fold: m[2] === '-' ? '-' : m[2] === '+' ? '+' : null, title: m[3] ?? '' };
}

/** The `>` prefix of a quoted line: up to three spaces, the marker, at most one space. */
export const QUOTE_PREFIX = /^ {0,3}>[ ]?/;
