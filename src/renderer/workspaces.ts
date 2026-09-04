import type { TabStrip } from './tabs';

/**
 * Named arrangements of panes and tabs.
 *
 * Defined narrowly, on purpose:
 *
 * > A workspace is a named snapshot of which notes are arranged in which panes.
 *
 * And nothing else. Not the folder being browsed, not the search box, not the
 * reading settings — a switch is spatial, not a wholesale change of mode, and
 * everything a workspace does not hold stays exactly as it was. That is also
 * why they are window state and not notebook content: nothing outside the
 * window can act on a pane arrangement, so they never reach settings.json,
 * the notes folder, the command line or MCP.
 *
 * They are snapshots, not live configurations. Opening a tab after loading one
 * does not quietly rewrite it; saying so is a separate, deliberate act.
 */

/** What a pane holds, which is all a workspace remembers of one. */
export interface PaneSnapshot extends TabStrip {
  preview: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  panes: PaneSnapshot[];
  paneAt: number;
  createdAt: string;
  updatedAt: string;
}

/** The longest a name may be. Long enough to say what it is for. */
export const MAX_NAME = 80;

/** A name as it is compared: two workspaces may not share one. */
export const nameKey = (name: string): string => name.trim().toLowerCase();

/** A name cleaned up, or empty when there is nothing left of it. */
export const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);

/** The workspaces from a store that may hold anything, malformed ones dropped. */
export function parseWorkspaces(raw: unknown): Workspace[] {
  if (!Array.isArray(raw)) return [];
  const out: Workspace[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const w = entry as Partial<Workspace>;
    const name = cleanName(typeof w.name === 'string' ? w.name : '');
    if (!name || typeof w.id !== 'string' || !w.id) continue;
    if (out.some((held) => nameKey(held.name) === nameKey(name) || held.id === w.id)) continue;
    const panes = (Array.isArray(w.panes) ? w.panes : []).map(parsePane).filter((p): p is PaneSnapshot => p !== null);
    if (panes.length === 0) continue;
    out.push({
      id: w.id,
      name,
      panes,
      paneAt: typeof w.paneAt === 'number' && w.paneAt >= 0 && w.paneAt < panes.length ? Math.floor(w.paneAt) : 0,
      createdAt: typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString(),
      updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

function parsePane(raw: unknown): PaneSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PaneSnapshot>;
  const tabs = Array.isArray(p.tabs) ? p.tabs.filter((id): id is string => typeof id === 'string') : [];
  const activeId = typeof p.activeId === 'string' ? p.activeId : null;
  return { tabs, activeId, preview: p.preview === true };
}

/** What loading a workspace works out to, once the notes it names are checked. */
export interface Resolved {
  panes: PaneSnapshot[];
  paneAt: number;
  /** How many tabs named notes that are not in the notebook now. */
  missing: number;
}

/**
 * A snapshot against the notebook as it stands.
 *
 * A note that has gone is left out and the rest is opened anyway: refusing
 * the whole arrangement because one note was trashed would make the feature
 * useless exactly when it is most wanted. The snapshot itself is **not**
 * rewritten — a file that is temporarily missing may come back.
 */
export function resolveWorkspace(workspace: Workspace, has: (id: string) => boolean): Resolved {
  let missing = 0;
  const panes = workspace.panes.map((pane) => {
    const tabs = pane.tabs.filter((id) => {
      if (has(id)) return true;
      missing++;
      return false;
    });
    const activeId = pane.activeId && tabs.includes(pane.activeId) ? pane.activeId : (tabs[0] ?? null);
    return { tabs, activeId, preview: pane.preview };
  });
  // Empty panes stay panes while any other holds something: the arrangement
  // is the point. With nothing left at all, one empty pane.
  const anything = panes.some((p) => p.tabs.length > 0);
  const kept = anything ? panes : [{ tabs: [], activeId: null, preview: false }];
  const paneAt = Math.min(Math.max(0, workspace.paneAt), kept.length - 1);
  return { panes: kept, paneAt, missing };
}

/** The list with one workspace saved into it, replacing a name already taken. */
export function withWorkspace(held: readonly Workspace[], made: Workspace): Workspace[] {
  const at = held.findIndex((w) => w.id === made.id || nameKey(w.name) === nameKey(made.name));
  if (at < 0) return [...held, made];
  return held.map((w, i) => (i === at ? { ...made, id: held[at].id, createdAt: held[at].createdAt } : w));
}

/** Whether the arrangement on screen is the one a workspace remembers. */
export function sameArrangement(a: readonly PaneSnapshot[], b: readonly PaneSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pane, i) => pane.activeId === b[i].activeId && pane.preview === b[i].preview && pane.tabs.length === b[i].tabs.length && pane.tabs.every((id, j) => id === b[i].tabs[j]));
}
