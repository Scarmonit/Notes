import type { NoteProperty, PropertyScalar, PropertyType } from '../shared/properties';
import { typeOfValue, valuesOf, writeScalar } from '../shared/properties';
import type { Note } from '../shared/types';

/**
 * What properties the notebook actually uses.
 *
 * A vocabulary sheet is not a nicety here. The moment a notebook can carry
 * arbitrary keys it grows `status`, `Status` and `state` inside a week, and
 * the fix is the same one 0.21.0 found for commands: show what there is,
 * rather than expecting anybody to remember it.
 *
 * Casing variants are listed, never merged. YAML keys are case-sensitive, so
 * `Status` really is another key; saying so is the only honest answer, and
 * completion from this list is what stops one being made by accident.
 */

/** One key, and what the notebook does with it. */
export interface PropertyUse {
  key: string;
  /** How many notes carry it. */
  noteCount: number;
  /** The shapes its value takes, in the order they were met. */
  types: PropertyType[];
  /** How many notes write it more than once. */
  duplicateCount: number;
  /** Other spellings of the same word used elsewhere in the notebook. */
  casingVariants: string[];
  /** Its distinct values, commonest first; a list contributes each of its items. */
  values: PropertyUseValue[];
}

export interface PropertyUseValue {
  /** The value as it would be typed into a search. */
  text: string;
  value: PropertyScalar;
  /** How many notes hold it. */
  noteCount: number;
}

/** Every custom property in a notebook, commonest first, then alphabetically. */
export function propertyVocabulary(notes: readonly Note[]): PropertyUse[] {
  const byKey = new Map<string, { notes: Set<string>; types: PropertyType[]; duplicates: Set<string>; values: Map<string, { value: PropertyScalar; notes: Set<string> }> }>();
  for (const note of notes) {
    const props = note.properties ?? [];
    const seenHere = new Set<string>();
    for (const prop of props) {
      let use = byKey.get(prop.key);
      if (!use) {
        use = { notes: new Set(), types: [], duplicates: new Set(), values: new Map() };
        byKey.set(prop.key, use);
      }
      if (seenHere.has(prop.key)) use.duplicates.add(note.id);
      seenHere.add(prop.key);
      use.notes.add(note.id);
      const type = typeOfValue(prop.value, prop.complex);
      if (!use.types.includes(type)) use.types.push(type);
      // A complex value is counted but never enumerated: its YAML is not a value to search for.
      for (const item of valuesOf(prop)) {
        const text = writeScalar(item);
        const at = use.values.get(text) ?? { value: item, notes: new Set<string>() };
        at.notes.add(note.id);
        use.values.set(text, at);
      }
    }
  }
  return [...byKey]
    .map(([key, use]) => ({
      key,
      noteCount: use.notes.size,
      types: use.types,
      duplicateCount: use.duplicates.size,
      casingVariants: [...byKey.keys()].filter((other) => other !== key && other.toLowerCase() === key.toLowerCase()).sort(),
      values: [...use.values]
        .map(([text, at]) => ({ text, value: at.value, noteCount: at.notes.size }))
        .sort((a, b) => b.noteCount - a.noteCount || a.text.localeCompare(b.text)),
    }))
    .sort((a, b) => b.noteCount - a.noteCount || a.key.localeCompare(b.key));
}

/**
 * Completion for a key being typed: what the notebook already calls things.
 *
 * Prefix matches first, then by how many notes use it, then alphabetically —
 * so the spelling that is already established is the one offered, and the
 * variant nobody meant to make sits below it rather than beside it.
 */
export function completeKey(vocabulary: readonly PropertyUse[], typed: string, limit = 8): PropertyUse[] {
  const want = typed.trim().toLowerCase();
  if (!want) return vocabulary.slice(0, limit);
  const scored = vocabulary
    .filter((use) => use.key.toLowerCase().includes(want))
    .map((use) => ({ use, prefix: use.key.toLowerCase().startsWith(want) ? 0 : 1 }))
    .sort((a, b) => a.prefix - b.prefix || b.use.noteCount - a.use.noteCount || a.use.key.localeCompare(b.use.key));
  return scored.slice(0, limit).map((s) => s.use);
}

/** The occurrences of one key on a note, in file order. */
export const occurrencesOf = (note: Pick<Note, 'properties'>, key: string): NoteProperty[] => (note.properties ?? []).filter((p) => p.key === key);
