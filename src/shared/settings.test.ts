import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('reads a file it wrote itself', () => {
    expect(parseSettings('{"closeToTray":true,"hotkey":"ctrl+shift+space"}')).toEqual({
      closeToTray: true,
      hotkey: 'ctrl+shift+space',
    });
  });

  it('treats an explicit null hotkey as "no hotkey", not as missing', () => {
    expect(parseSettings('{"closeToTray":false,"hotkey":null}').hotkey).toBeNull();
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

  it('only counts a literal true as close-to-tray', () => {
    expect(parseSettings('{"closeToTray":"yes"}').closeToTray).toBe(false);
  });
});
