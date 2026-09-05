import { describe, expect, it } from 'vitest';
import { hasFilterOpts, splitQuery } from './context';

describe('splitQuery', () => {
  it('takes the quotes off a phrase, the way a shell would have', () => {
    // The quotes were handed on to the query parser, which matches on the text
    // itself -- so a saved search for a phrase searched for the quotes too and
    // found nothing.
    expect(splitQuery('"quick brown"')).toEqual(['quick brown']);
    // And an operator whose value is quoted stays one word, rather than being
    // torn in half at the space inside it.
    expect(splitQuery('links:"My Note" plans')).toEqual(['links:My Note', 'plans']);
  });

  it('leaves bare words, tags, exclusions and patterns as they were', () => {
    expect(splitQuery('quick brown')).toEqual(['quick', 'brown']);
    expect(splitQuery('#wow -draft')).toEqual(['#wow', '-draft']);
    expect(splitQuery('/ab+c/i')).toEqual(['/ab+c/i']);
    expect(splitQuery('tag:work due:today')).toEqual(['tag:work', 'due:today']);
  });
});

describe('hasFilterOpts', () => {
  it('counts a saved search as something said', () => {
    // Without this `notes export --view Work` read as "nothing was said" and
    // exported the whole notebook, and `notes delete --view Work` refused.
    expect(hasFilterOpts({ view: 'Work' })).toBe(true);
  });

  it('still reads no flags, and ordering alone, as nothing said', () => {
    expect(hasFilterOpts({})).toBe(false);
    expect(hasFilterOpts({ sort: 'title', reverse: true })).toBe(false);
  });
});
