import { describe, expect, it } from 'vitest';
import { caretUsable, emptyJourney, forget, goBack, goForward, hashOf, leave, parseRecent, pruneRecent, RECENT_LIMIT, STACK_LIMIT, visited, type Place } from './journey';

const place = (id: string, caret = 0, body = ''): Place => ({ id, caret, scroll: 0, hash: hashOf(body) });

describe('journey', () => {
  it('goes back through the notes left, and forward again', () => {
    let j = emptyJourney();
    j = leave(j, place('a', 5));
    j = leave(j, place('b', 7));
    const back1 = goBack(j, place('c'));
    expect(back1?.to).toEqual(place('b', 7));
    const back2 = goBack(back1!.journey, place('b', 7));
    expect(back2?.to).toEqual(place('a', 5));
    expect(goBack(back2!.journey, place('a'))).toBeNull();
    const fwd = goForward(back2!.journey, place('a', 5));
    expect(fwd?.to).toEqual(place('b', 7));
    expect(fwd?.journey.back).toEqual([place('a', 5)]);
    expect(goForward(fwd!.journey, place('b'))?.to).toEqual(place('c'));
  });

  it('keeps only the latest place when the same note is left twice running', () => {
    let j = leave(emptyJourney(), place('a', 1));
    j = leave(j, place('a', 9));
    expect(j.back).toEqual([place('a', 9)]);
  });

  it('forgets the forward path on a new departure', () => {
    let j = leave(emptyJourney(), place('a'));
    j = leave(j, place('b'));
    const back = goBack(j, place('c'))!;
    expect(back.journey.forward).toHaveLength(1);
    expect(leave(back.journey, place('d')).forward).toEqual([]);
  });

  it('caps the stack', () => {
    let j = emptyJourney();
    for (let i = 0; i < STACK_LIMIT + 20; i++) j = leave(j, place(`n${i}`));
    expect(j.back).toHaveLength(STACK_LIMIT);
    expect(j.back[0].id).toBe('n20');
  });

  it('trusts a saved caret only while the text is unchanged', () => {
    const p = place('a', 4, 'hello');
    expect(caretUsable(p, 'hello')).toBe(true);
    expect(caretUsable(p, 'hello!')).toBe(false);
    expect(hashOf('')).not.toBe(hashOf('a'));
  });

  it('drops a note from both directions when it is gone', () => {
    let j = leave(emptyJourney(), place('a'));
    j = leave(j, place('b'));
    const back = goBack(j, place('c'))!;
    const pruned = forget(back.journey, 'c');
    expect(pruned.forward).toEqual([]);
    expect(forget(pruned, 'a').back).toEqual([]);
  });
});

describe('recent notes', () => {
  it('lists visits newest first, each note once, capped', () => {
    let r = visited([], 'a', 1);
    r = visited(r, 'b', 2);
    r = visited(r, 'a', 3);
    expect(r).toEqual([
      { id: 'a', at: 3 },
      { id: 'b', at: 2 },
    ]);
    for (let i = 0; i < RECENT_LIMIT + 5; i++) r = visited(r, `n${i}`, 10 + i);
    expect(r).toHaveLength(RECENT_LIMIT);
    expect(r[0].id).toBe(`n${RECENT_LIMIT + 4}`);
  });

  it('prunes what no longer exists and parses stored state defensively', () => {
    expect(pruneRecent([{ id: 'a', at: 1 }, { id: 'b', at: 2 }], (id) => id === 'b')).toEqual([{ id: 'b', at: 2 }]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent([{ id: 'a', at: 1 }, { id: 2 }, 'x', { id: 'b', at: 'no' }])).toEqual([{ id: 'a', at: 1 }]);
  });
});
