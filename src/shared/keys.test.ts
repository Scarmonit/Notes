import { describe, expect, it } from 'vitest';
import { acceleratorOf, chordOf, isCommandChord, keyLabel } from './keys';

describe('chordOf', () => {
  it('spells modifiers in a fixed order, whatever the event says first', () => {
    expect(chordOf({ key: 'D', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+d');
    expect(chordOf({ key: 'ArrowUp', altKey: true })).toBe('alt+arrowup');
    expect(chordOf({ key: 'N', ctrlKey: true, shiftKey: true, altKey: true })).toBe('ctrl+shift+alt+n');
  });

  it('treats the meta key as Ctrl, so one spelling covers both', () => {
    expect(chordOf({ key: 'k', metaKey: true })).toBe('ctrl+k');
  });

  it('keeps punctuation as itself and names the space bar', () => {
    expect(chordOf({ key: ',', ctrlKey: true })).toBe('ctrl+,');
    expect(chordOf({ key: '\\', ctrlKey: true })).toBe('ctrl+\\');
    expect(chordOf({ key: ' ', ctrlKey: true })).toBe('ctrl+space');
  });

  it('is empty while only a modifier is held', () => {
    expect(chordOf({ key: 'Control', ctrlKey: true })).toBe('');
    expect(chordOf({ key: 'Shift', shiftKey: true })).toBe('');
  });
});

describe('isCommandChord', () => {
  it('accepts anything holding Ctrl or Alt', () => {
    expect(isCommandChord('ctrl+n')).toBe(true);
    expect(isCommandChord('alt+arrowup')).toBe(true);
    expect(isCommandChord('ctrl+shift+p')).toBe(true);
  });

  it('rejects plain typing, Shift included', () => {
    expect(isCommandChord('a')).toBe(false);
    expect(isCommandChord('shift+a')).toBe(false);
    expect(isCommandChord('')).toBe(false);
  });
});

describe('keyLabel', () => {
  it('draws a chord the way the sheet shows it', () => {
    expect(keyLabel('ctrl+shift+d')).toEqual(['Ctrl', 'Shift', 'D']);
    expect(keyLabel('ctrl+arrowdown')).toEqual(['Ctrl', '↓']);
    expect(keyLabel('ctrl+,')).toEqual(['Ctrl', ',']);
  });
});

describe('acceleratorOf', () => {
  it('translates a chord into Electron’s spelling', () => {
    expect(acceleratorOf('ctrl+alt+n')).toBe('Control+Alt+N');
    expect(acceleratorOf('ctrl+shift+arrowup')).toBe('Control+Shift+Up');
    expect(acceleratorOf('ctrl+,')).toBe('Control+Comma');
  });

  it('refuses what Electron cannot register', () => {
    // A bare key is not a global shortcut, and Electron has no word for these.
    expect(acceleratorOf('n')).toBeNull();
    expect(acceleratorOf('ctrl+§')).toBeNull();
    expect(acceleratorOf('')).toBeNull();
  });
});
