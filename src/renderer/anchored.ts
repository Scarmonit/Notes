/**
 * Putting a small floating thing beside something else.
 *
 * Two surfaces need this and neither should own it: the peek card, which
 * hangs off a link, and the slash menu, which hangs off the caret. They are
 * different components with different focus and dismissal rules — this is
 * only the arithmetic of where the box goes.
 *
 * The order is right, then left, then below, then above, then clamped. It may
 * overlap what is under it, but it never leaves the window: a card half off
 * the screen is worse than one covering a paragraph.
 */

export interface AnchorBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  left: number;
  top: number;
  /** Which way it went, for anything that wants to know. */
  side: 'right' | 'left' | 'below' | 'above';
}

export interface PlaceOptions {
  /** How far from the anchor. */
  gap?: number;
  /** How close to the window edge it may come. */
  margin?: number;
}

/**
 * Where a box of this size goes beside this anchor, inside this window.
 *
 * Everything is in viewport coordinates, which is what `getBoundingClientRect`
 * gives and what `position: fixed` takes, so nothing here has to know about
 * scrolling.
 */
export function place(anchor: AnchorBox, size: { width: number; height: number }, view: { width: number; height: number }, options: PlaceOptions = {}): Placed {
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const fits = (left: number, top: number): boolean => left >= margin && top >= margin && left + size.width <= view.width - margin && top + size.height <= view.height - margin;
  // Beside it, aligned to its top; under or over it, aligned to its left.
  const beside = clamp(anchor.top, margin, view.height - margin - size.height);
  const along = clamp(anchor.left, margin, view.width - margin - size.width);
  const tries: Array<[Placed['side'], number, number]> = [
    ['right', anchor.right + gap, beside],
    ['left', anchor.left - gap - size.width, beside],
    ['below', along, anchor.bottom + gap],
    ['above', along, anchor.top - gap - size.height],
  ];
  for (const [side, left, top] of tries) if (fits(left, top)) return { left, top, side };
  // Nothing fits: put it where there is most room and pull it inside.
  const below = view.height - anchor.bottom > anchor.top;
  return {
    left: along,
    top: clamp(below ? anchor.bottom + gap : anchor.top - gap - size.height, margin, Math.max(margin, view.height - margin - size.height)),
    side: below ? 'below' : 'above',
  };
}

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), Math.max(low, high));

/** The box a range occupies, for anything anchored to the caret rather than an element. */
export function caretBox(range: Range): AnchorBox | null {
  const rect = range.getBoundingClientRect();
  // A collapsed caret at a line boundary has no height; the line it is on does.
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    if (rects.length === 0) return null;
    const first = rects[0];
    return { left: first.left, top: first.top, right: first.right, bottom: first.bottom };
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
