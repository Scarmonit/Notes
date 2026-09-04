/**
 * Front-matter properties: the YAML keys on a note that the app does not own.
 *
 * A note's front matter has always carried keys this app knows nothing about —
 * `status: draft` written in Obsidian, say — and has always written them back
 * untouched. This module is what makes them visible: it says what a value
 * means, and how a changed one is written back.
 *
 * There is no type registry. A property's type is whatever its YAML says it
 * is, worked out again on every parse, because a second schema kept outside
 * the markdown would contradict the folder on disk being the artifact.
 *
 * The reading is deliberately conservative. Only `true`, `false`, `null` and
 * an unambiguous number are anything but a string, so a value that merely
 * looks like a date or a list of one stays the text that was typed.
 */

/** One value in a list. Lists are flat: a list of lists is not a property this app edits. */
export type PropertyScalar = string | number | boolean | null;

/** What a property is worth: a scalar, or a flat list of them. */
export type PropertyValue = PropertyScalar | PropertyScalar[];

/** The name for a value's shape, as the sheet and the command line report it. */
export type PropertyType = 'string' | 'number' | 'boolean' | 'null' | 'list' | 'complex';

/**
 * One property as the rest of the app reads it.
 *
 * An occurrence rather than a key, because YAML lets a key appear twice and
 * this app refuses to silently pick one: both are shown, both are searchable,
 * and an edit names which.
 */
export interface NoteProperty {
  key: string;
  value: PropertyValue;
  /** Which occurrence of this key it is, counting from 1 in file order. */
  occurrence: number;
  /** True when the value is YAML the app can show but not edit. */
  complex: boolean;
}

/** The shape of a value, for the sheet's Type column and `--json`. */
export function typeOfValue(value: PropertyValue, complex = false): PropertyType {
  if (complex) return 'complex';
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** A number YAML and JavaScript agree on: no `Infinity`, no `1_000`, no `0x10`. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/**
 * What a scalar written in YAML means here.
 *
 * Exactly `true`, `false` and `null` are those; a plain finite number is a
 * number; everything else is a string, quotes removed if it had them. `yes`,
 * `2026-09-06` and `[draft]` are all text, because guessing otherwise would
 * change what the file says.
 */
export function parseScalar(raw: string): PropertyScalar {
  const text = raw.trim();
  if (text.startsWith('"') || text.startsWith("'")) return unquote(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (NUMBER.test(text)) return Number(text);
  return text;
}

/** What the person typed into a value field, read the same conservative way. */
export const parseTyped = (typed: string): PropertyScalar => {
  const text = typed.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (NUMBER.test(text)) return Number(text);
  return typed;
};

/** A front-matter string value: quoted the way it was written, or bare. */
export function unquote(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not a JSON string after all; fall through to the raw text.
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** The characters that start something in YAML rather than a word. */
const INDICATOR = new Set(['-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`']);

/**
 * True when a string can be written without quotes and still read back as
 * exactly itself. Everything else is double-quoted, and the person is never
 * asked about it: they are editing a value, not YAML.
 */
export function isPlain(text: string): boolean {
  if (!text) return false;
  if (text !== text.trim()) return false;
  if (INDICATOR.has(text[0])) return false;
  if (text.includes(': ') || text.endsWith(':')) return false;
  if (text.includes(' #')) return false;
  if (/[\n\r\t]/.test(text)) return false;
  // Anything that would read back as another type has to be quoted to stay text.
  return !(text === 'true' || text === 'false' || text === 'null' || NUMBER.test(text));
}

/** One scalar as YAML: plain where that is unambiguous, double-quoted where it is not. */
export function writeScalar(value: PropertyScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return isPlain(value) ? value : JSON.stringify(value);
}

/** How a list was written, so an edit keeps the style the file already had. */
export type ListStyle = 'inline' | 'block';

/**
 * A property written back as front-matter lines.
 *
 * A new list is written as indented `- item` lines, which is the form that
 * survives every item; an existing one keeps the style it had. An empty list
 * is `[]`, because `key:` with nothing under it reads as null.
 */
export function writeProperty(key: string, value: PropertyValue, style: ListStyle = 'block'): string[] {
  if (!Array.isArray(value)) return [`${key}: ${writeScalar(value)}`];
  if (value.length === 0) return [`${key}: []`];
  if (style === 'inline') return [`${key}: [${value.map(writeScalar).join(', ')}]`];
  return [`${key}:`, ...value.map((item) => `  - ${writeScalar(item)}`)];
}

/** A key the app will create: deliberately narrower than everything YAML allows. */
export const SIMPLE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Whether two values are the same for a `prop:key=value` search.
 *
 * Strings compare without case over the whole value — never a substring, so a
 * search for `draft` does not find `final draft`. Numbers compare as numbers,
 * and a boolean or null matches only its own kind.
 */
export function sameValue(a: PropertyScalar, b: PropertyScalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** True when a property holds this value, a list counting as any of its items. */
export function propertyHas(prop: NoteProperty, want: PropertyScalar): boolean {
  if (prop.complex) return false;
  if (Array.isArray(prop.value)) return prop.value.some((item) => sameValue(item, want));
  return sameValue(prop.value, want);
}

/** Every value a property offers a search, so a list contributes each item. */
export function valuesOf(prop: NoteProperty): PropertyScalar[] {
  if (prop.complex) return [];
  return Array.isArray(prop.value) ? prop.value : [prop.value];
}

/** What a property change asks for: a value to set, or nothing, which removes it. */
export interface PropertyChange {
  key: string;
  /** The value to write. Absent removes the property. */
  value?: PropertyValue;
  /** Which occurrence, counting from 1. Needed only when the key was written twice. */
  occurrence?: number;
  /** Remove every occurrence of the key, rather than one. */
  all?: boolean;
}

/** A key written twice, where the change did not say which one it meant. */
export class AmbiguousProperty extends Error {
  constructor(
    readonly key: string,
    readonly count: number,
  ) {
    super(`'${key}' is written ${count} times on that note; say which with an occurrence, or remove them all`);
    this.name = 'AmbiguousProperty';
  }
}
