/**
 * One spelling for a key combination, shared by the in-app keyboard map, the
 * shortcuts sheet, the command palette and the system-wide hotkey.
 *
 * A chord is lower case, modifiers first in a fixed order: `ctrl+shift+d`,
 * `alt+arrowup`, `ctrl+,`. Everything that needs a combination — matching a
 * keystroke, drawing it as <kbd>, handing it to Electron — starts from that
 * one string, so the three can never describe different keys.
 */

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph', 'capslock']);

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** The chord a keystroke spells, or '' while only modifiers are held. */
export function chordOf(e: KeyLike): string {
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

/**
 * True when the chord holds Ctrl or Alt, so it cannot be ordinary typing.
 * Shift alone does not count: Shift+A is a capital letter, not a command.
 */
export function isCommandChord(chord: string): boolean {
  const parts = chord.split('+');
  return parts.length > 1 && (parts.includes('ctrl') || parts.includes('alt'));
}

const NAMES: Record<string, string> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  enter: 'Enter',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Del',
  tab: 'Tab',
  '\\': '\\',
};

/** The pieces of a chord as they should be drawn, one <kbd> each. */
export function keyLabel(chord: string): string[] {
  if (!chord) return [];
  return chord.split('+').map((part) => NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}

const ACCELERATOR: Record<string, string> = {
  ctrl: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Esc',
  enter: 'Return',
  space: 'Space',
  ',': 'Comma',
  '.': 'Period',
  '\\': '\\',
};

/**
 * The same chord as an Electron accelerator, for `globalShortcut`. Returns
 * null when the chord is not something Electron can register: a bare key with
 * no modifier, or one whose name Electron has no word for.
 */
export function acceleratorOf(chord: string): string | null {
  const parts = chord.split('+').filter(Boolean);
  if (parts.length < 2) return null;
  const out: string[] = [];
  for (const part of parts) {
    const named = ACCELERATOR[part];
    if (named) out.push(named);
    else if (/^[a-z0-9]$/.test(part)) out.push(part.toUpperCase());
    else if (/^f\d{1,2}$/.test(part)) out.push(part.toUpperCase());
    else return null;
  }
  return out.join('+');
}
