/**
 * The notes open in one pane, and which of them it is showing.
 *
 * All of it is arithmetic on a list of ids: which tab a chosen note replaces,
 * where a new one goes, what is shown once one is closed. None of it touches
 * the DOM, so the rules a window with tabs lives by can be read — and tested —
 * without a window.
 */
export interface TabStrip {
  /** The notes open in the pane, left to right. */
  tabs: string[];
  /** The one on screen, or null when the pane holds nothing. */
  activeId: string | null;
}

const same = (strip: TabStrip): TabStrip => ({ tabs: [...strip.tabs], activeId: strip.activeId });

/**
 * Shows a note in the pane. Choosing a note turns the page — it takes the
 * place of the one showing — unless it is already open in a tab of its own,
 * which is then simply brought forward. That is what keeps a sidebar full of
 * notes from becoming a strip full of tabs.
 */
export function showTab(strip: TabStrip, id: string | null): TabStrip {
  if (id === null) return { tabs: [...strip.tabs], activeId: null };
  if (strip.tabs.includes(id)) return { tabs: [...strip.tabs], activeId: id };
  const at = strip.activeId === null ? -1 : strip.tabs.indexOf(strip.activeId);
  const tabs = [...strip.tabs];
  if (at >= 0) tabs[at] = id;
  else tabs.push(id);
  return { tabs, activeId: id };
}

/** Opens a note in a tab of its own, just after the one showing. */
export function addTab(strip: TabStrip, id: string): TabStrip {
  if (strip.tabs.includes(id)) return { tabs: [...strip.tabs], activeId: id };
  const at = strip.activeId === null ? -1 : strip.tabs.indexOf(strip.activeId);
  const tabs = [...strip.tabs];
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, id);
  return { tabs, activeId: id };
}

/**
 * Closes a tab. Closing the one showing moves along to its neighbour — the
 * tab that slid into its place, or the last one when it was the last.
 */
export function shutTab(strip: TabStrip, id: string): TabStrip {
  const at = strip.tabs.indexOf(id);
  if (at < 0) return same(strip);
  const tabs = strip.tabs.filter((t) => t !== id);
  if (strip.activeId !== id) return { tabs, activeId: strip.activeId };
  return { tabs, activeId: tabs[Math.min(at, tabs.length - 1)] ?? null };
}

/** The next tab along, wrapping round. A pane with one tab stays where it is. */
export function stepTab(strip: TabStrip, delta: 1 | -1): TabStrip {
  if (strip.tabs.length < 2) return same(strip);
  const at = strip.activeId === null ? -1 : strip.tabs.indexOf(strip.activeId);
  const next = (Math.max(0, at) + delta + strip.tabs.length) % strip.tabs.length;
  return { tabs: [...strip.tabs], activeId: strip.tabs[next] };
}

/**
 * The nth tab, counting from one — and the ninth is the last of them, however
 * many there are, which is what Ctrl+9 means everywhere else.
 */
export function nthTab(strip: TabStrip, n: number): string | null {
  if (n === 9) return strip.tabs[strip.tabs.length - 1] ?? null;
  return strip.tabs[n - 1] ?? null;
}

/**
 * Drops the notes that are no longer there. A pane showing one of them moves
 * to whatever slid into its place, so a deleted note never leaves a pane
 * looking at nothing while other notes are open in it.
 */
export function keepTabs(strip: TabStrip, exists: (id: string) => boolean): TabStrip {
  const tabs = strip.tabs.filter(exists);
  if (tabs.length === strip.tabs.length && (strip.activeId === null || exists(strip.activeId))) return same(strip);
  if (strip.activeId !== null && exists(strip.activeId)) return { tabs, activeId: strip.activeId };
  const at = strip.activeId === null ? -1 : strip.tabs.indexOf(strip.activeId);
  return { tabs, activeId: (at < 0 ? tabs[0] : tabs[Math.min(at, tabs.length - 1)]) ?? null };
}
