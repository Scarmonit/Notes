// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, atTime, endOfDay, parseDueMoment, parseDueWindow, reminderAt } from './due';
import { parseWhen } from './query';

/**
 * Due dates across a clock change. Adding 24 hours to midnight lands at
 * 01:00 or 23:00 on the day the clocks move, so `2d` typed the day before
 * put a task on the wrong day and a 14:30 reminder fired at 15:30. These
 * run in a zone with daylight saving whatever the machine's own is.
 */
const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
let tz: string | undefined;

beforeAll(() => {
  tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  // Prove the zone took: the offsets either side of the March change differ.
  expect(new Date(2026, 2, 7, 12).getTimezoneOffset()).not.toBe(new Date(2026, 2, 8, 12).getTimezoneOffset());
});
afterAll(() => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

describe('due moments across a clock change', () => {
  it('counts days through the calendar, not in 24-hour steps', () => {
    expect(addDays(local(2026, 3, 7), 1)).toBe(local(2026, 3, 8));
    expect(addDays(local(2026, 11, 1), 1)).toBe(local(2026, 11, 2));
    expect(atTime(local(2026, 3, 8), 14, 30)).toBe(local(2026, 3, 8, 14, 30));
    expect(endOfDay(local(2026, 11, 1))).toBe(local(2026, 11, 1, 23, 59) + 59999);
  });
  it('puts a task typed as 2d or tomorrow 14:30 on the right day at the right time', () => {
    expect(parseDueMoment('2d', local(2026, 10, 31, 12))).toEqual({ at: local(2026, 11, 2), withTime: false });
    expect(parseDueMoment('tomorrow 14:30', local(2026, 3, 7, 12))).toEqual({ at: local(2026, 3, 8, 14, 30), withTime: true });
    expect(parseDueMoment('mon', local(2026, 11, 1, 12))).toEqual({ at: local(2026, 11, 2), withTime: false });
    expect(parseDueMoment('2026-03-08 09:00', local(2026, 3, 1, 12))).toEqual({ at: local(2026, 3, 8, 9), withTime: true });
  });
  it('keeps the tomorrow window a whole day and the morning reminder at nine', () => {
    expect(parseDueWindow('tomorrow', local(2026, 11, 1, 12))).toEqual({ from: local(2026, 11, 2), until: local(2026, 11, 2, 23, 59) + 59999 });
    expect(parseDueWindow('1d', local(2026, 3, 7, 12))?.until).toBe(local(2026, 3, 8, 23, 59) + 59999);
    expect(reminderAt({ due: local(2026, 3, 8), hasTime: false })).toBe(local(2026, 3, 8, 9));
    expect(parseWhen('yesterday', local(2026, 11, 2, 12))).toBe(local(2026, 11, 1));
  });
});
