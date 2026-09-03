/**
 * Fenced code blocks — the ``` lines around a run of text.
 *
 * A fence is what stops a wall of commands from being reflowed: inside one,
 * the columns a writer lined up by hand stay where they were put. Like the
 * checklist functions, everything here works on the markdown text and never
 * on the DOM, so one function serves the shortcut and anything else that
 * needs it later.
 */

/** A fence line: three or more backticks or tildes, with an optional language. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[^`]*$/;

export const isFenceLine = (line: string): boolean => FENCE.test(line);

export interface Fenced {
  body: string;
  /** The line the caret should end up on. */
  line: number;
}

/**
 * Puts a fence around lines `first` to `last`, or takes one away when the
 * block is already fenced. Unfencing looks both at the lines just outside the
 * block and at the block's own first and last lines, so it works whether the
 * caret sits in the code or on the fence itself.
 */
export function toggleFence(text: string, first: number, last: number, lang = ''): Fenced {
  const lines = text.split('\n');
  const from = Math.max(0, Math.min(lines.length - 1, first));
  const to = Math.max(from, Math.min(lines.length - 1, last));

  const outerOpen = from - 1 >= 0 && isFenceLine(lines[from - 1]);
  const outerClose = to + 1 < lines.length && isFenceLine(lines[to + 1]);
  if (outerOpen && outerClose) {
    const kept = [...lines.slice(0, from - 1), ...lines.slice(from, to + 1), ...lines.slice(to + 2)];
    return { body: kept.join('\n'), line: Math.max(0, from - 1) };
  }
  if (to > from && isFenceLine(lines[from]) && isFenceLine(lines[to])) {
    const kept = [...lines.slice(0, from), ...lines.slice(from + 1, to), ...lines.slice(to + 1)];
    return { body: kept.join('\n'), line: from };
  }

  const open = lang.trim() ? `\`\`\`${lang.trim()}` : '```';
  const next = [...lines.slice(0, from), open, ...lines.slice(from, to + 1), '```', ...lines.slice(to + 1)];
  return { body: next.join('\n'), line: to + 1 };
}
