import { linkKey, linksIn, namesOf, noteForLink, titleOf } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * Notes that say a note's name in plain words without linking to it.
 *
 * This is the other half of backlinks. Backlinks answer "what points here";
 * unlinked mentions answer "what talks about this and has not been joined up
 * yet" — the notes written before the note existed, or written in a hurry.
 * Finding them is the same pass, reading titles instead of link targets.
 */

export interface Mention {
  note: Note;
  /** The name of the target that was found: its title, or one of its aliases. */
  name: string;
  /** Where in the body the words sit, so the linker can rewrite exactly that. */
  start: number;
  end: number;
  /** The line the words are on, and the line itself, for the strip to show. */
  line: number;
  text: string;
}

/** A name as a pattern that matches only whole words. */
function wordsOf(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b does not fire beside a non-word character, so the edges are checked by
  // hand: a name may begin or end with punctuation ("C++", "Re: plans").
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

/** The spans a body has already spoken for: its links, its fences, its inline code, its URLs. */
function spoken(body: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const push = (re: RegExp): void => {
    for (const m of body.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  };
  push(/\[\[[^\[\]\n]*\]\]/g);
  push(/```[\s\S]*?(?:```|$)/g);
  push(/`[^`\n]*`/g);
  push(/\[[^\]\n]*\]\([^)\n]*\)/g);
  push(/\bhttps?:\/\/\S+/g);
  return out;
}

const inside = (spans: Array<{ start: number; end: number }>, at: number): boolean => spans.some((s) => at >= s.start && at < s.end);

/** The line a position is on, and that line's text. */
function lineAt(body: string, at: number): { line: number; text: string } {
  const before = body.slice(0, at);
  const line = before.split('\n').length - 1;
  const start = before.lastIndexOf('\n') + 1;
  const end = body.indexOf('\n', at);
  return { line, text: body.slice(start, end < 0 ? body.length : end).trim() };
}

/**
 * Every note that names this one in plain text and does not link to it. One
 * mention per note — the first — because the offer is "join these two up",
 * not "rewrite every sentence".
 */
export function unlinkedMentions(notes: Note[], id: string, limit = 12): Mention[] {
  const target = notes.find((n) => n.id === id);
  if (!target) return [];
  const names = namesOf(target).filter((n) => n.trim().length >= 3 && n !== 'Untitled');
  if (names.length === 0) return [];
  const patterns = names.map((name) => ({ name, re: wordsOf(name) }));
  const out: Mention[] = [];
  for (const note of notes) {
    if (note.id === id) continue;
    // A note that already links here is joined up; that is what backlinks are for.
    if (linksIn(note.body).some((t) => noteForLink(notes, t)?.id === id)) continue;
    const spans = spoken(note.body);
    let best: Mention | null = null;
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      for (const m of note.body.matchAll(re)) {
        if (inside(spans, m.index)) continue;
        const at = lineAt(note.body, m.index);
        const found: Mention = { note, name, start: m.index, end: m.index + m[0].length, ...at };
        if (!best || found.start < best.start) best = found;
        break;
      }
    }
    // The title itself saying the name is not a mention worth joining up.
    if (best) out.push(best);
    if (out.length >= limit) break;
  }
  return out;
}

/** How the words read once they are linked: `[[Target|as written]]`, or plain when the two match. */
export function linkedText(target: string, written: string): string {
  return linkKey(target) === linkKey(written) ? `[[${written}]]` : `[[${target}|${written}]]`;
}

/** The body of a mentioning note with that one mention turned into a link. */
export function linkMention(body: string, mention: Pick<Mention, 'start' | 'end'>, target: Note): string | null {
  const written = body.slice(mention.start, mention.end);
  if (!written.trim()) return null;
  return `${body.slice(0, mention.start)}${linkedText(titleOf(target), written)}${body.slice(mention.end)}`;
}
