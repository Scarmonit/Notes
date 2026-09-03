import type { Graph } from '../core/related';

/**
 * A force layout for the graph sheet, written by hand: a few hundred notes
 * at most, drawn once when the sheet opens, so nothing a library would add
 * — and the page's script may only come from itself. Fruchterman–Reingold
 * in spirit: every node repels every other, every edge pulls its ends
 * together, and a cooling step size settles it. Positions start on a
 * spiral seeded by node order, so the same notes lay out the same way twice.
 */

export interface LaidOut {
  id: string;
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  /** How much room each node wants; larger spreads the graph out. */
  spacing?: number;
}

export function layoutGraph(graph: Graph, options: LayoutOptions): LaidOut[] {
  const { width, height } = options;
  const n = graph.nodes.length;
  if (n === 0) return [];
  const iterations = options.iterations ?? 300;
  const index = new Map(graph.nodes.map((node, i) => [node.id, i] as const));
  const area = width * height;
  const k = (options.spacing ?? 1) * Math.sqrt(area / n) * 0.8;

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  // A spiral out from the centre: deterministic, and nothing starts on top of anything.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const radius = Math.min(width, height) * 0.42;
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + 0.5) / n);
    const a = i * golden;
    x[i] = width / 2 + r * Math.cos(a);
    y[i] = height / 2 + r * Math.sin(a);
  }
  const edges = graph.edges.map((e) => [index.get(e.from) ?? -1, index.get(e.to) ?? -1] as const).filter(([a, b]) => a >= 0 && b >= 0 && a !== b);
  // Notes with no links drift outward and stay out of the way; a pull to the
  // centre keeps the connected part from flying apart.
  const gravity = 0.03;

  let temperature = Math.max(width, height) / 8;
  const cool = temperature / iterations;
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = x[i] - x[j];
        let ddy = y[i] - y[j];
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) {
          ddx = (i - j) * 0.1;
          ddy = 0.1;
          d2 = ddx * ddx + ddy * ddy;
        }
        const force = (k * k) / d2;
        const fx = ddx * force;
        const fy = ddy * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }
    for (const [a, b] of edges) {
      const ddx = x[a] - x[b];
      const ddy = y[a] - y[b];
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = (d * d) / k / d;
      const fx = ddx * force;
      const fy = ddy * force;
      dx[a] -= fx;
      dy[a] -= fy;
      dx[b] += fx;
      dy[b] += fy;
    }
    for (let i = 0; i < n; i++) {
      dx[i] += (width / 2 - x[i]) * gravity;
      dy[i] += (height / 2 - y[i]) * gravity;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
      const step = Math.min(d, temperature);
      x[i] += (dx[i] / d) * step;
      y[i] += (dy[i] / d) * step;
    }
    temperature -= cool;
  }
  // Fit whatever came out into the box, with a margin for labels.
  const margin = 40;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY, 1.5);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return graph.nodes.map((node, i) => ({ id: node.id, x: offX + (x[i] - minX) * scale, y: offY + (y[i] - minY) * scale }));
}

/** The node under a point, if any, for clicks: nearest within its radius. */
export function nodeAt(points: LaidOut[], radii: Map<string, number>, px: number, py: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const r = (radii.get(p.id) ?? 6) + 4;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= r && d < bestD) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}
