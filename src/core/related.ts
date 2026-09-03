import { linkKey, linksIn, tagPath, tagsOf, titleOf } from '../renderer/notes';
import type { Note } from '../shared/types';

/**
 * What else is near a note, beyond the links written into it: the notes
 * that share its tags, and the notes two hops away along links — the ones
 * that point at the same places, and the ones pointed at by the notes that
 * point here. Zettlr lists these as "related files"; here they sit under
 * the backlinks, so a note's neighbourhood is on the page without a graph.
 */

export interface Related {
  note: Note;
  score: number;
  /** Why it is here, for the tooltip: `#wow`, `also links to Plan`. */
  reasons: string[];
}

/** The notes near one, best first. Direct links either way are left out: they are already on the page. */
export function relatedNotes(notes: Note[], id: string, limit = 8): Related[] {
  const me = notes.find((n) => n.id === id);
  if (!me) return [];
  const myTitle = linkKey(titleOf(me));
  const myTags = tagsOf(me.body);
  const myLinks = new Set(linksIn(me.body).map(linkKey));
  const byKey = new Map(notes.map((n) => [linkKey(titleOf(n)), n] as const));
  const outgoing = (n: Note): Set<string> => new Set(linksIn(n.body).map(linkKey));
  const backlinks = notes.filter((n) => n.id !== id && outgoing(n).has(myTitle));
  const direct = new Set<string>([id, ...backlinks.map((n) => n.id), ...[...myLinks].map((k) => byKey.get(k)?.id).filter((x): x is string => Boolean(x))]);

  const scores = new Map<string, Related>();
  const add = (n: Note, points: number, reason: string): void => {
    if (direct.has(n.id)) return;
    const r = scores.get(n.id) ?? { note: n, score: 0, reasons: [] };
    r.score += points;
    if (!r.reasons.includes(reason)) r.reasons.push(reason);
    scores.set(n.id, r);
  };

  for (const n of notes) {
    if (n.id === id) continue;
    const theirs = tagsOf(n.body);
    for (const tag of myTags) {
      // The exact tag is worth more than sharing a parent: #wow/commands and
      // #wow/macros are cousins, not twins.
      if (theirs.includes(tag)) add(n, 3, `#${tag}`);
      else {
        const parent = tagPath(tag).slice(0, -1).reverse().find((p) => theirs.some((t) => t === p || t.startsWith(`${p}/`)));
        if (parent) add(n, 1, `#${parent}`);
      }
    }
    if (myLinks.size > 0) {
      const shared = [...outgoing(n)].filter((k) => myLinks.has(k));
      for (const k of shared) add(n, 2, `also links to ${titleOf(byKey.get(k) ?? { body: k })}`);
    }
  }
  for (const back of backlinks) {
    for (const k of outgoing(back)) {
      const sibling = byKey.get(k);
      if (sibling && sibling.id !== id) add(sibling, 2, `linked from ${titleOf(back)}`);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt || a.note.id.localeCompare(b.note.id)).slice(0, limit);
}

export interface GraphNode {
  id: string;
  title: string;
  /** Links out and links in, for sizing. */
  out: number;
  in: number;
  tags: string[];
  pinned: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Every note as a node and every resolvable [[link]] as an edge, once. Links to nothing are left out. */
export function graphOf(notes: Note[]): Graph {
  const byKey = new Map(notes.map((n) => [linkKey(titleOf(n)), n] as const));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const n of notes) {
    for (const target of linksIn(n.body)) {
      const hit = byKey.get(linkKey(target));
      if (!hit || hit.id === n.id) continue;
      const key = `${n.id}>${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: n.id, to: hit.id });
      outCount.set(n.id, (outCount.get(n.id) ?? 0) + 1);
      inCount.set(hit.id, (inCount.get(hit.id) ?? 0) + 1);
    }
  }
  const nodes = notes.map((n) => ({ id: n.id, title: titleOf(n), out: outCount.get(n.id) ?? 0, in: inCount.get(n.id) ?? 0, tags: tagsOf(n.body), pinned: n.pinned === true }));
  return { nodes, edges };
}

/** The graph in Graphviz's dot language, for `notes graph --dot | dot -Tsvg`. */
export function toDot(graph: Graph): string {
  const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = ['digraph notes {', '  rankdir=LR;', '  node [shape=box, style=rounded, fontname="Helvetica"];'];
  for (const n of graph.nodes) lines.push(`  ${q(n.id)} [label=${q(n.title)}];`);
  for (const e of graph.edges) lines.push(`  ${q(e.from)} -> ${q(e.to)};`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** The part of the graph within `hops` links of a note, either direction. */
export function neighbourhood(graph: Graph, id: string, hops: number): Graph {
  const keep = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops && frontier.length > 0; h++) {
    const next: string[] = [];
    for (const e of graph.edges) {
      if (frontier.includes(e.from) && !keep.has(e.to)) {
        keep.add(e.to);
        next.push(e.to);
      }
      if (frontier.includes(e.to) && !keep.has(e.from)) {
        keep.add(e.from);
        next.push(e.from);
      }
    }
    frontier = next;
  }
  return { nodes: graph.nodes.filter((n) => keep.has(n.id)), edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}
