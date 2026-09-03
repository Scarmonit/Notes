/**
 * Where the reader has been: the back/forward stack behind Alt+Left and
 * Alt+Right, and the recent-notes list. Pure state, so it can be tested
 * without a window; main.ts records a place whenever a note is left and
 * puts one back when asked.
 */

export interface Place {
  id: string;
  /** Caret offset into the body when the note was left. */
  caret: number;
  /** The editor's scrollTop when the note was left. */
  scroll: number;
  /** A hash of the body as it was, so the caret is only trusted while the text is unchanged. */
  hash: number;
}

export const STACK_LIMIT = 100;
export const RECENT_LIMIT = 20;

/** A cheap 32-bit hash of a string (FNV-1a), enough to notice an edit. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Journey {
  back: Place[];
  forward: Place[];
}

export const emptyJourney = (): Journey => ({ back: [], forward: [] });

/**
 * Records the place being left. Leaving the same note twice in a row keeps
 * only the latest place, so a stack of edits within one note does not turn
 * Back into a long walk; a new departure forgets the forward path.
 */
export function leave(j: Journey, place: Place): Journey {
  const top = j.back[j.back.length - 1];
  const back = top && top.id === place.id ? [...j.back.slice(0, -1), place] : [...j.back, place];
  return { back: back.slice(-STACK_LIMIT), forward: [] };
}

/** Steps back: the place to go to, and the journey with `here` kept for Forward. */
export function goBack(j: Journey, here: Place): { journey: Journey; to: Place } | null {
  const to = j.back[j.back.length - 1];
  if (!to) return null;
  return { to, journey: { back: j.back.slice(0, -1), forward: [...j.forward, here].slice(-STACK_LIMIT) } };
}

/** Steps forward again after a Back. */
export function goForward(j: Journey, here: Place): { journey: Journey; to: Place } | null {
  const to = j.forward[j.forward.length - 1];
  if (!to) return null;
  return { to, journey: { back: [...j.back, here].slice(-STACK_LIMIT), forward: j.forward.slice(0, -1) } };
}

/** Whether the caret saved in a place may be put back: only while the text is what it was. */
export const caretUsable = (place: Place, body: string): boolean => hashOf(body) === place.hash;

/** A note that was gone from the notes has nothing to return to. */
export function forget(j: Journey, id: string): Journey {
  return { back: j.back.filter((p) => p.id !== id), forward: j.forward.filter((p) => p.id !== id) };
}

// --- recent notes ---------------------------------------------------------------

export interface Visit {
  id: string;
  at: number;
}

/** Puts a visit at the front of the recent list, once per note, newest first. */
export function visited(recent: Visit[], id: string, at: number): Visit[] {
  return [{ id, at }, ...recent.filter((v) => v.id !== id)].slice(0, RECENT_LIMIT);
}

/** The recent list without notes that no longer exist. */
export function pruneRecent(recent: Visit[], exists: (id: string) => boolean): Visit[] {
  return recent.filter((v) => exists(v.id));
}

/** Reads a stored recent list, dropping anything that is not a visit. */
export function parseRecent(raw: unknown): Visit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Visit => typeof v === 'object' && v !== null && typeof (v as Visit).id === 'string' && typeof (v as Visit).at === 'number')
    .map((v) => ({ id: v.id, at: v.at }))
    .slice(0, RECENT_LIMIT);
}
