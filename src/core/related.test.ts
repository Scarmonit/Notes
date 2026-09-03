// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layoutGraph, nodeAt } from '../renderer/graph';
import type { Note } from '../shared/types';
import { graphOf, neighbourhood, relatedNotes, toDot } from './related';

const note = (id: string, body: string, title?: string, updatedAt = 1): Note => ({ id, body, createdAt: 1, updatedAt, ...(title ? { title } : {}) });

const notes = [
  note('me', 'about wow #wow/commands links [[Plan]]', 'Me'),
  note('plan', 'the plan', 'Plan'),
  note('twin', 'also #wow/commands', 'Twin', 5),
  note('cousin', 'under #wow/macros', 'Cousin', 4),
  note('sibling', 'links [[Plan]] too', 'Sibling', 3),
  note('back', 'points at [[Me]] and [[Far]]', 'Back'),
  note('far', 'two hops away', 'Far'),
  note('stranger', 'nothing in common', 'Stranger'),
  note('dangling', 'links [[Nowhere]]', 'Dangling'),
];

describe('relatedNotes', () => {
  it('ranks shared tags, shared link targets and two-hop links, leaving direct links out', () => {
    const rel = relatedNotes(notes, 'me');
    expect(rel.map((r) => [r.note.id, r.score, r.reasons])).toEqual([
      ['twin', 3, ['#wow/commands']],
      ['sibling', 2, ['also links to Plan']],
      ['far', 2, ['linked from Back']],
      ['cousin', 1, ['#wow']],
    ]);
    expect(relatedNotes(notes, 'nope')).toEqual([]);
    expect(relatedNotes(notes, 'me', 2)).toHaveLength(2);
  });
});

describe('graphOf', () => {
  it('makes one edge per resolvable link and counts degrees', () => {
    const g = graphOf(notes);
    expect(g.edges).toEqual([
      { from: 'me', to: 'plan' },
      { from: 'sibling', to: 'plan' },
      { from: 'back', to: 'me' },
      { from: 'back', to: 'far' },
    ]);
    expect(g.nodes.find((n) => n.id === 'plan')).toMatchObject({ in: 2, out: 0, title: 'Plan' });
    expect(g.nodes.find((n) => n.id === 'dangling')).toMatchObject({ in: 0, out: 0 });
    expect(neighbourhood(g, 'me', 1).nodes.map((n) => n.id).sort()).toEqual(['back', 'me', 'plan']);
    expect(neighbourhood(g, 'me', 2).nodes.map((n) => n.id).sort()).toEqual(['back', 'far', 'me', 'plan', 'sibling']);
    expect(toDot(g)).toContain('"me" -> "plan";');
    expect(toDot(g)).toContain('label="Plan"');
  });
});

describe('layoutGraph', () => {
  it('places every node inside the box, deterministically, with linked nodes nearer than strangers', () => {
    const g = graphOf(notes);
    const a = layoutGraph(g, { width: 800, height: 600 });
    const b = layoutGraph(g, { width: 800, height: 600 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(notes.length);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
    const at = (id: string) => a.find((p) => p.id === id) as { x: number; y: number };
    const dist = (p: string, q: string) => Math.hypot(at(p).x - at(q).x, at(p).y - at(q).y);
    expect(dist('me', 'plan')).toBeLessThan(dist('me', 'stranger'));
    expect(nodeAt(a, new Map(), at('plan').x + 2, at('plan').y - 2)).toBe('plan');
    expect(layoutGraph({ nodes: [], edges: [] }, { width: 10, height: 10 })).toEqual([]);
  });
});
