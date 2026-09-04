import { describe, expect, it } from 'vitest';
import { addTab, keepTabs, nthTab, showTab, shutTab, stepTab, type TabStrip } from './tabs';

const strip = (tabs: string[], activeId: string | null = tabs[0] ?? null): TabStrip => ({ tabs, activeId });

describe('showTab', () => {
  it('turns the page: the chosen note takes the place of the one showing', () => {
    expect(showTab(strip(['a', 'b'], 'a'), 'c')).toEqual({ tabs: ['c', 'b'], activeId: 'c' });
  });

  it('brings a note already open forward rather than opening it twice', () => {
    expect(showTab(strip(['a', 'b'], 'a'), 'b')).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
  });

  it('opens the first note of an empty pane', () => {
    expect(showTab(strip([], null), 'a')).toEqual({ tabs: ['a'], activeId: 'a' });
  });

  it('leaves the tabs alone when nothing is to be shown', () => {
    expect(showTab(strip(['a', 'b'], 'b'), null)).toEqual({ tabs: ['a', 'b'], activeId: null });
  });
});

describe('addTab', () => {
  it('opens a note just after the one showing', () => {
    expect(addTab(strip(['a', 'b'], 'a'), 'c')).toEqual({ tabs: ['a', 'c', 'b'], activeId: 'c' });
  });

  it('opens at the end when the pane is showing nothing', () => {
    expect(addTab(strip(['a', 'b'], null), 'c')).toEqual({ tabs: ['a', 'b', 'c'], activeId: 'c' });
  });

  it('brings an open note forward instead of opening a second tab for it', () => {
    expect(addTab(strip(['a', 'b'], 'a'), 'b')).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
  });
});

describe('shutTab', () => {
  it('moves to the tab that slid into its place', () => {
    expect(shutTab(strip(['a', 'b', 'c'], 'b'), 'b')).toEqual({ tabs: ['a', 'c'], activeId: 'c' });
  });

  it('moves back when the last tab is closed', () => {
    expect(shutTab(strip(['a', 'b'], 'b'), 'b')).toEqual({ tabs: ['a'], activeId: 'a' });
  });

  it('leaves the pane showing nothing when its only tab goes', () => {
    expect(shutTab(strip(['a'], 'a'), 'a')).toEqual({ tabs: [], activeId: null });
  });

  it('keeps showing what it was showing when another tab goes', () => {
    expect(shutTab(strip(['a', 'b', 'c'], 'c'), 'a')).toEqual({ tabs: ['b', 'c'], activeId: 'c' });
  });

  it('does nothing about a tab that is not open', () => {
    expect(shutTab(strip(['a'], 'a'), 'zz')).toEqual({ tabs: ['a'], activeId: 'a' });
  });
});

describe('stepTab', () => {
  it('wraps round in both directions', () => {
    expect(stepTab(strip(['a', 'b', 'c'], 'c'), 1).activeId).toBe('a');
    expect(stepTab(strip(['a', 'b', 'c'], 'a'), -1).activeId).toBe('c');
  });

  it('stays put with one tab, or none', () => {
    expect(stepTab(strip(['a'], 'a'), 1).activeId).toBe('a');
    expect(stepTab(strip([], null), 1).activeId).toBe(null);
  });
});

describe('nthTab', () => {
  it('counts from one', () => {
    expect(nthTab(strip(['a', 'b', 'c']), 2)).toBe('b');
  });

  it('makes the ninth the last, however many there are', () => {
    expect(nthTab(strip(['a', 'b', 'c']), 9)).toBe('c');
  });

  it('is nothing when the pane has no such tab', () => {
    expect(nthTab(strip(['a']), 4)).toBe(null);
  });
});

describe('keepTabs', () => {
  const gone = (id: string): boolean => id !== 'b';

  it('drops the notes that are no longer there', () => {
    expect(keepTabs(strip(['a', 'b', 'c'], 'a'), gone)).toEqual({ tabs: ['a', 'c'], activeId: 'a' });
  });

  it('moves a pane showing a deleted note to the tab in its place', () => {
    expect(keepTabs(strip(['a', 'b', 'c'], 'b'), gone)).toEqual({ tabs: ['a', 'c'], activeId: 'c' });
  });

  it('leaves a pane showing nothing when every note it held has gone', () => {
    expect(keepTabs(strip(['b'], 'b'), gone)).toEqual({ tabs: [], activeId: null });
  });

  it('changes nothing when every note is still there', () => {
    expect(keepTabs(strip(['a', 'c'], 'c'), gone)).toEqual({ tabs: ['a', 'c'], activeId: 'c' });
  });
});
