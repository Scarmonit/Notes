import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const s = 1000;
const m = 60 * s;
const h = 60 * m;
const d = 24 * h;

describe('relativeTime', () => {
  it('rounds recent edits to just now', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now');
    expect(relativeTime(NOW - 30 * s, NOW)).toBe('just now');
    expect(relativeTime(NOW + 5 * s, NOW)).toBe('just now');
  });
  it('counts minutes and hours', () => {
    expect(relativeTime(NOW - 5 * m, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 59 * m, NOW)).toBe('59 min ago');
    expect(relativeTime(NOW - 3 * h, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 23 * h, NOW)).toBe('23 h ago');
  });
  it('names yesterday and counts days under a week', () => {
    expect(relativeTime(NOW - 1 * d, NOW)).toBe('yesterday');
    expect(relativeTime(NOW - 4 * d, NOW)).toBe('4 days ago');
  });
  it('shows a date after a week, with the year only when it differs', () => {
    expect(relativeTime(NOW - 10 * d, NOW)).toMatch(/Aug/);
    expect(relativeTime(NOW - 10 * d, NOW)).not.toMatch(/2026/);
    expect(relativeTime(NOW - 400 * d, NOW)).toMatch(/2025/);
  });
});
