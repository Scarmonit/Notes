import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cleanSettings, cleanViews, parseSettings, viewNamed, withView } from './settings';

describe('parseSettings', () => {
  it('reads a file it wrote itself', () => {
    expect(parseSettings('{"closeToTray":true,"hotkey":"ctrl+shift+space","captureHotkey":"ctrl+alt+q"}')).toEqual({
      closeToTray: true,
      hotkey: 'ctrl+shift+space',
      captureHotkey: 'ctrl+alt+q',
      reminders: true,
      views: [],
      notesFolder: null,
    });
  });

  it('gives a file from before the quick-note box the default capture chord', () => {
    expect(parseSettings('{"closeToTray":true,"hotkey":"ctrl+shift+space"}').captureHotkey).toBe(DEFAULT_SETTINGS.captureHotkey);
  });

  it('treats an explicit null hotkey as "no hotkey", not as missing', () => {
    expect(parseSettings('{"closeToTray":false,"hotkey":null}').hotkey).toBeNull();
    expect(parseSettings('{"captureHotkey":null}').captureHotkey).toBeNull();
  });

  it('falls back to the default hotkey when the stored one is unusable', () => {
    expect(parseSettings('{"hotkey":"n"}').hotkey).toBe(DEFAULT_SETTINGS.hotkey);
    expect(parseSettings('{"hotkey":7}').hotkey).toBe(DEFAULT_SETTINGS.hotkey);
  });

  it('survives a file that is not settings at all', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2,3]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('turns reminders off only on an explicit false', () => {
    expect(parseSettings('{}').reminders).toBe(true);
    expect(parseSettings('{"reminders":false}').reminders).toBe(false);
    expect(parseSettings('{"reminders":"no"}').reminders).toBe(true);
  });

  it('only counts a literal true as close-to-tray', () => {
    expect(parseSettings('{"closeToTray":"yes"}').closeToTray).toBe(false);
  });
});

describe('cleanSettings', () => {
  it('keeps only the known fields and drops chords that cannot be registered', () => {
    const dirty = { closeToTray: true, hotkey: 'x', captureHotkey: 'ctrl+alt+space', stray: 1 } as never;
    expect(cleanSettings(dirty)).toEqual({ closeToTray: true, hotkey: null, captureHotkey: 'ctrl+alt+space', reminders: true, views: [], notesFolder: null });
  });
});

describe('saved searches', () => {
  it('keeps named, non-empty views and drops the rest', () => {
    expect(cleanViews([{ name: 'Due', query: 'due:week' }, { name: ' ', query: 'x' }, { name: 'A', query: '' }, 'nope', null])).toEqual([
      { name: 'Due', query: 'due:week' },
    ]);
  });

  it('keeps the first of two views sharing a name', () => {
    expect(cleanViews([{ name: 'Due', query: 'a' }, { name: 'due', query: 'b' }])).toEqual([{ name: 'Due', query: 'a' }]);
  });

  it('finds a view by name, or by a prefix only one starts', () => {
    const views = [{ name: 'Due soon', query: 'a' }, { name: 'Orphans', query: 'b' }];
    expect(viewNamed(views, 'orphans')?.query).toBe('b');
    expect(viewNamed(views, 'due')?.query).toBe('a');
    expect(viewNamed(views, 'x')).toBeNull();
    expect(viewNamed([{ name: 'Due a', query: 'a' }, { name: 'Due b', query: 'b' }], 'due')).toBeNull();
  });

  it('replaces a view by name and keeps the order of the rest', () => {
    const views = [{ name: 'A', query: '1' }, { name: 'B', query: '2' }];
    expect(withView(views, 'a', '9')).toEqual([{ name: 'a', query: '9' }, { name: 'B', query: '2' }]);
    expect(withView(views, 'C', '3')).toHaveLength(3);
  });

  it('reads views out of a file and writes them back', () => {
    expect(parseSettings('{"views":[{"name":"Due","query":"due:week todo:"}]}').views).toEqual([{ name: 'Due', query: 'due:week todo:' }]);
    expect(parseSettings('{"views":"nope"}').views).toEqual([]);
  });
});
