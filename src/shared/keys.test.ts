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

  it('accepts a function key on its own: nothing types an F2', () => {
    expect(isCommandChord('f2')).toBe(true);
    expect(isCommandChord('f12')).toBe(true);
    expect(isCommandChord('fx')).toBe(false);
  });
});

describe('keyLabel', () => {
  it('draws a function key in capitals', () => {
    expect(keyLabel('f2')).toEqual(['F2']);
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

describe('a chord on a punctuation key', () => {
  it('becomes an accelerator, since the settings sheet lets one be recorded', () => {
    // `isCommandChord` accepted these and `acceleratorOf` refused them, so the
    // hotkey was stored as no hotkey at all with nothing said about why.
    for (const key of [';', '/', "'", '[', ']', '-', '=']) {
      expect(isCommandChord(`ctrl+alt+${key}`), key).toBe(true);
      expect(acceleratorOf(`ctrl+alt+${key}`), key).toBe(`Control+Alt+${key}`);
    }
  });

  it('keeps the names Electron has its own word for', () => {
    expect(acceleratorOf('ctrl+alt+,')).toBe('Control+Alt+Comma');
    expect(acceleratorOf('ctrl+alt+.')).toBe('Control+Alt+Period');
  });

  it('still refuses a bare key and a name Electron has no word for', () => {
    expect(acceleratorOf('k')).toBe(null);
    expect(acceleratorOf('ctrl+alt+somekey')).toBe(null);
  });
});
