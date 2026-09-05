import { describe, expect, it } from 'vitest';
import { calloutHead, CALLOUT_KINDS } from './callouts';

describe('calloutHead', () => {
  it('reads the kind, the fold and the title', () => {
    expect(calloutHead('[!info] A title')).toEqual({ kind: 'info', label: 'Info', fold: null, title: 'A title' });
    expect(calloutHead('[!warning]-')).toEqual({ kind: 'warning', label: 'Warning', fold: '-', title: '' });
    expect(calloutHead('[!tip]+ Open')).toEqual({ kind: 'tip', label: 'Tip', fold: '+', title: 'Open' });
  });

  it('knows the thirteen kinds and their aliases, whatever the case', () => {
    expect(CALLOUT_KINDS).toHaveLength(13);
    expect(calloutHead('[!SUMMARY]')?.kind).toBe('abstract');
    expect(calloutHead('[!Hint]')?.label).toBe('Tip');
    expect(calloutHead('[!cite]')?.kind).toBe('quote');
    expect(calloutHead('[!error]')?.kind).toBe('danger');
  });

  it('treats an unknown kind as a note wearing its own name', () => {
    expect(calloutHead('[!foo] x')).toEqual({ kind: 'note', label: 'Foo', fold: null, title: 'x' });
  });

  it('is not fooled by an ordinary quote or a broken head', () => {
    expect(calloutHead('just words')).toBeNull();
    expect(calloutHead('[!info')).toBeNull();
    expect(calloutHead('[!]')).toBeNull();
    expect(calloutHead('[!info]x')).toBeNull();
  });
});
