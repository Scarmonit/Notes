import { describe, expect, it } from 'vitest';
import { keyMap, matchActions, type Action } from './actions';

const noop = (): void => undefined;

const act = (id: string, label: string, extra: Partial<Action> = {}): Action => ({
  id,
  label,
  group: 'Notes',
  run: noop,
  ...extra,
});

const ACTIONS: Action[] = [
  act('new', 'New note', { chord: 'ctrl+n' }),
  act('find', 'Find a note', { chord: 'ctrl+k', also: ['ctrl+f'], terms: 'search' }),
  act('preview', 'Markdown preview', { chord: 'ctrl+e', group: 'View' }),
  act('delete', 'Delete this note', { chord: 'ctrl+shift+d', enabled: () => false }),
];

const ids = (query: string): string[] => matchActions(ACTIONS, query).map((m) => m.action.id);

describe('matchActions', () => {
  it('keeps the registry order when nothing is typed', () => {
    expect(ids('')).toEqual(['new', 'find', 'preview']);
  });

  it('hides commands that cannot run right now', () => {
    expect(ids('delete')).toEqual([]);
  });

  it('matches letters in order, not just whole words', () => {
    expect(ids('mkpv')).toEqual(['preview']);
  });

  it('puts word beginnings first', () => {
    // "nn" begins both words of "New note" and only straddles the others.
    expect(ids('nn')[0]).toBe('new');
  });

  it('finds a command by an extra term without underlining anything', () => {
    const [match] = matchActions(ACTIONS, 'search');
    expect(match.action.id).toBe('find');
    expect(match.hits).toEqual([]);
  });

  it('reports which characters of the label matched, in order', () => {
    const [match] = matchActions(ACTIONS, 'note');
    const matched = match.hits.map((i) => match.action.label[i]).join('');
    expect(matched.toLowerCase()).toBe('note');
    expect([...match.hits]).toEqual([...match.hits].sort((a, b) => a - b));
  });

  it('returns nothing for a query no command contains', () => {
    expect(ids('zzz')).toEqual([]);
  });
});

describe('keyMap', () => {
  it('maps every chord a command answers to, alternates included', () => {
    const map = keyMap(ACTIONS);
    expect(map.get('ctrl+n')?.id).toBe('new');
    expect(map.get('ctrl+k')?.id).toBe('find');
    expect(map.get('ctrl+f')?.id).toBe('find');
  });

  it('keeps disabled commands, so their key is still theirs', () => {
    expect(keyMap(ACTIONS).get('ctrl+shift+d')?.id).toBe('delete');
  });

  it('gives a contested chord to whichever command claims it first', () => {
    const map = keyMap([act('a', 'A', { chord: 'ctrl+q' }), act('b', 'B', { chord: 'ctrl+q' })]);
    expect(map.get('ctrl+q')?.id).toBe('a');
  });
});
