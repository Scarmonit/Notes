/**
 * Find and replace within one note: pure work on the markdown text. The
 * editor paints the matches as ranges; the text itself is only changed by a
 * replace, and then as a whole, through the same path every other rewrite
 * of the body takes.
 */

export interface FindOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export interface FindMatch {
  start: number;
  end: number;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for a query, or null when it is empty or not a valid expression. */
function patternOf(query: string, opts: FindOptions, mode: 'all' | 'here' | 'one'): RegExp | null {
  if (!query) return null;
  const flags = `${mode === 'all' ? 'g' : mode === 'here' ? 'y' : ''}${opts.caseSensitive ? '' : 'i'}`;
  const source = opts.regex ? query : escapeRegex(query);
  try {
    return new RegExp(source, `${flags}u`);
  } catch {
    // Unicode mode is stricter about escapes (`\-`, `\_`) that a typed expression may well use.
    if (!opts.regex) return null;
    try {
      return new RegExp(source, flags);
    } catch {
      return null;
    }
  }
}

/** Whether the query is something that can be searched for at all. */
export function validQuery(query: string, opts: FindOptions): boolean {
  return patternOf(query, opts, 'all') !== null;
}

/** Every match in the text, in order. An empty match is skipped, so `a*` cannot match everywhere. */
export function findMatches(text: string, query: string, opts: FindOptions): FindMatch[] {
  const re = patternOf(query, opts, 'all');
  if (!re) return [];
  const out: FindMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The index of the first match starting at or after `offset`, wrapping to the first. */
export function matchFrom(matches: FindMatch[], offset: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.start >= offset);
  return i < 0 ? 0 : i;
}

/**
 * What one match becomes. In regex mode the replacement can refer to groups
 * ($1), so the pattern is run again, at the match's place in the whole text
 * — not on the matched slice alone, where a lookbehind or an anchor that
 * found it there would find nothing.
 */
export function replacementFor(text: string, match: FindMatch, query: string, replacement: string, opts: FindOptions): string {
  if (!opts.regex) return replacement;
  const re = patternOf(query, opts, 'here');
  if (!re) return replacement;
  re.lastIndex = match.start;
  const out = text.replace(re, replacement);
  return out.slice(match.start, out.length - (text.length - match.end));
}

/** The text with one match replaced. */
export function replaceOne(text: string, match: FindMatch, query: string, replacement: string, opts: FindOptions): string {
  return text.slice(0, match.start) + replacementFor(text, match, query, replacement, opts) + text.slice(match.end);
}

/** The text with every match replaced, and how many there were. */
export function replaceAll(text: string, query: string, replacement: string, opts: FindOptions): { text: string; count: number } {
  const matches = findMatches(text, query, opts);
  if (matches.length === 0) return { text, count: 0 };
  let out = '';
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.start) + replacementFor(text, m, query, replacement, opts);
    at = m.end;
  }
  return { text: out + text.slice(at), count: matches.length };
}
