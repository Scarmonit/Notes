/**
 * Every command the app can run, described once.
 *
 * The keyboard map, the shortcuts sheet and the command palette are all built
 * from the same list, so a shortcut cannot exist without being findable, and
 * the sheet cannot claim a key that no longer runs anything.
 */

export type ActionGroup = 'Notes' | 'Writing' | 'View' | 'Window';

export interface Action {
  id: string;
  /** How the command reads in the palette and the sheet. */
  label: string;
  group: ActionGroup;
  /** The chord that runs it, in the `ctrl+shift+d` spelling of shared/keys. */
  chord?: string;
  /** Chords that also run it; the sheet shows them beside the first. */
  also?: string[];
  /** A sentence for the shortcuts sheet, when the label alone is thin. */
  hint?: string;
  /** Extra words the palette should find it by. */
  terms?: string;
  run: () => void;
  /** Greyed out and unrunnable while this returns false. */
  enabled?: () => boolean;
  /** For toggles: whether the thing is currently on. */
  on?: () => boolean;
}

export interface Match {
  action: Action;
  /** Which characters of the label the query matched, for highlighting. */
  hits: number[];
  score: number;
}

/**
 * Scores one candidate against a lower-cased query as a subsequence: every
 * character of the query must appear in order. Matches at the start of a word
 * count for more, so "nn" finds "New note" ahead of "Toggle preview".
 * Returns null when the query does not fit at all.
 */
function score(text: string, query: string): { score: number; hits: number[] } | null {
  const hay = text.toLowerCase();
  const hits: number[] = [];
  let total = 0;
  let at = 0;
  for (const ch of query) {
    const found = hay.indexOf(ch, at);
    if (found < 0) return null;
    const boundary = found === 0 || /[\s(–-]/.test(hay[found - 1]);
    const consecutive = hits.length > 0 && found === hits[hits.length - 1] + 1;
    total += boundary ? 12 : consecutive ? 8 : 2;
    hits.push(found);
    at = found + 1;
  }
  // A tight match beats one strung out across the whole label.
  const span = hits[hits.length - 1] - hits[0] + 1;
  return { score: total - span * 0.4 - text.length * 0.05, hits };
}

/**
 * The actions worth showing for what has been typed, best first. An empty
 * query keeps the registry's own order, which groups related commands.
 */
export function matchActions(actions: Action[], query: string): Match[] {
  const q = query.trim().toLowerCase();
  const runnable = actions.filter((a) => a.enabled?.() !== false);
  if (!q) return runnable.map((action) => ({ action, hits: [], score: 0 }));
  const out: Match[] = [];
  runnable.forEach((action, index) => {
    const onLabel = score(action.label, q);
    // Extra terms find the command but never highlight, so the label stays readable.
    const best = onLabel ?? (action.terms ? score(`${action.label} ${action.terms}`, q) : null);
    if (!best) return;
    out.push({ action, hits: onLabel ? best.hits : [], score: best.score - index * 0.01 });
  });
  return out.sort((a, b) => b.score - a.score);
}

/** The chord-to-action map the keyboard handler dispatches through. */
export function keyMap(actions: Action[]): Map<string, Action> {
  const map = new Map<string, Action>();
  for (const action of actions) {
    for (const chord of [action.chord, ...(action.also ?? [])]) {
      if (chord && !map.has(chord)) map.set(chord, action);
    }
  }
  return map;
}
