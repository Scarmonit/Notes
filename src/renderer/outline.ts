import { isFenceLine } from './fences';
import { plainText } from './notes';

/**
 * The headings of a note, for the outline beside it. Pure line work on the
 * markdown: a heading is a `#` line outside a code fence, and the outline
 * lists them with the line they sit on, so a click can go straight there.
 */

export interface Heading {
  /** 1 for `#`, 6 for `######`. */
  level: number;
  /** The heading's words, with the markers and inline emphasis stripped. */
  text: string;
  /** The line of the body it is on, counted from 0. */
  line: number;
}

// A closing run of #s is dropped only after a space, as markdown reads it: `# C#` is about C#.
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

export function headingsIn(body: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  body.split('\n').forEach((raw, line) => {
    if (isFenceLine(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = HEADING.exec(raw);
    if (!m) return;
    const text = plainText(m[2]);
    if (text) out.push({ level: m[1].length, text, line });
  });
  return out;
}

/** The index of the heading the caret's line falls under: the last one at or above it, or -1. */
export function headingAt(headings: Heading[], line: number): number {
  let at = -1;
  for (let i = 0; i < headings.length && headings[i].line <= line; i++) at = i;
  return at;
}
