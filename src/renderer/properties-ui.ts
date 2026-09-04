import { completeKey, propertyVocabulary, type PropertyUse } from '../core/vocabulary';
import { SIMPLE_KEY, typeOfValue, writeScalar, type NoteProperty, type PropertyScalar, type PropertyValue } from '../shared/properties';
import type { Note } from '../shared/types';
import { titleOf } from './notes';

/**
 * The properties sheet: the front-matter keys a note carries, and the
 * vocabulary the notebook uses.
 *
 * A modal sheet rather than a band inside the editor, because the editor's
 * strongest promise is that what you see in the writing surface is the file.
 * A form built into that surface would be the first thing there that is not
 * the note's own markdown.
 *
 * Everything here goes through a host the window supplies — the notes, how
 * to write a property, where to put the sheet — so the whole flow can be
 * driven in a test without the rest of the window.
 */

export interface PropertiesHost {
  notes(): Note[];
  selected(): Note | null;
  /**
   * Writes one property. `value` absent removes it; `occurrence` says which,
   * for a key written more than once. Resolves to what went wrong, or null.
   */
  write(id: string, change: { key: string; value?: PropertyValue; occurrence?: number; all?: boolean }): Promise<string | null>;
  /** Renames the note's aliases, which have their own operation and their own place in the file. */
  writeAliases(id: string, names: string[]): void;
  /** Runs a search, which is how a value in the vocabulary sheet is followed. */
  search(query: string): void;
  status(text: string, ms: number): void;
  focusEditor(): void;
  root: HTMLElement;
}

export interface PropertiesUi {
  /** The note's own properties. `focusKey` opens with that row's value focused. */
  open(focusKey?: string): void;
  /** Every property the notebook uses. */
  openVocabulary(): void;
  /** True while either sheet is showing. */
  isOpen(): boolean;
  /** Closes whichever is open; true when there was one. */
  close(): boolean;
  /** Redraws from the notes as they now stand, after an outside change. */
  refresh(): void;
}

/**
 * The note's own fields. They are shown so the sheet tells the whole truth
 * about the front matter, but each is changed through the operation that owns
 * it rather than edited as YAML — a title renames the file and can carry its
 * links, and a date is the note's own.
 */
const RESERVED_ROWS: Array<{ key: string; how: string }> = [
  { key: 'title', how: 'The title box, or Ctrl+R' },
  { key: 'aliases', how: 'A [[link]] naming one finds this note' },
  { key: 'pinned', how: 'Ctrl+Shift+P' },
  { key: 'created', how: "The note's own" },
  { key: 'updated', how: "The note's own" },
];

export function createPropertiesUi(host: PropertiesHost): PropertiesUi {
  let sheet: HTMLElement | null = null;
  /** Which note the open sheet is about, so an outside change can be ignored when it is another note. */
  let openId: string | null = null;
  let mode: 'note' | 'vocabulary' = 'note';
  /** The key whose completion list is showing, and what has been typed at it. */
  let adding: { key: string; value: string } | null = null;
  /** Keys unfolded in the vocabulary sheet. */
  const unfolded = new Set<string>();
  let filter = '';

  const noteNow = (): Note | null => (openId ? (host.notes().find((n) => n.id === openId) ?? null) : null);

  function close(): boolean {
    if (!sheet) return false;
    sheet.remove();
    sheet = null;
    openId = null;
    adding = null;
    unfolded.clear();
    filter = '';
    host.focusEditor();
    return true;
  }

  function shell(label: string): HTMLElement {
    sheet?.remove();
    const el = document.createElement('div');
    el.className = 'sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', label);
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) close();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    host.root.append(el);
    sheet = el;
    return el;
  }

  // --- the note's own properties --------------------------------------------

  function open(focusKey?: string): void {
    const note = host.selected();
    if (!note) return;
    openId = note.id;
    mode = 'note';
    adding = null;
    const el = shell(`Properties of ${titleOf(note)}`);
    el.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'sheet-card props-card';
    card.tabIndex = -1;
    el.append(card);
    drawNote(card);
    const want = focusKey ? card.querySelector<HTMLElement>(`[data-value-for="${cssEscape(focusKey)}"]`) : null;
    (want ?? card).focus();
  }

  function drawNote(card: HTMLElement): void {
    const note = noteNow();
    if (!note) {
      close();
      return;
    }
    card.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = 'Properties';
    const who = document.createElement('p');
    who.className = 'props-note';
    who.textContent = titleOf(note);
    card.append(h2, who);

    card.append(fieldsSection(note));

    const props = note.properties ?? [];
    const list = document.createElement('div');
    list.className = 'props-list';
    list.setAttribute('role', 'list');
    if (props.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'props-empty';
      empty.textContent = 'This note carries no properties of its own.';
      list.append(empty);
    }
    for (const prop of props) list.append(propertyRow(note, prop, card));
    card.append(sectionHead('Properties'), list);

    card.append(addRow(note, card));

    const foot = document.createElement('p');
    foot.className = 'sheet-foot u';
    foot.innerHTML = 'A property is a key in the note’s own front matter · <kbd>Ctrl+Z</kbd> undoes a change · <kbd>Esc</kbd> closes';
    card.append(foot);
  }

  function sectionHead(text: string): HTMLElement {
    const head = document.createElement('h3');
    head.className = 'props-head u';
    head.textContent = text;
    return head;
  }

  /** The note's own fields: shown, so the sheet tells the truth, but changed elsewhere. */
  function fieldsSection(note: Note): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'props-fields';
    wrap.append(sectionHead('Note fields'));
    const shown: Record<string, string> = {
      title: note.title?.trim() || `${titleOf(note)} (from the first line)`,
      aliases: (note.aliases ?? []).join(', ') || '—',
      pinned: note.pinned ? 'true' : 'false',
      created: new Date(note.createdAt).toLocaleString(),
      updated: new Date(note.updatedAt).toLocaleString(),
    };
    for (const field of RESERVED_ROWS) {
      const row = document.createElement('div');
      row.className = 'props-field';
      const key = document.createElement('span');
      key.className = 'props-key';
      key.textContent = field.key;
      // Aliases are the one reserved field with an editor of its own, so this
      // sheet is the only place properties are edited rather than the second.
      const value = field.key === 'aliases' ? aliasBox(note) : readOnly(shown[field.key]);
      const how = document.createElement('span');
      how.className = 'props-how u';
      how.textContent = field.how;
      row.append(key, value, how);
      wrap.append(row);
    }
    return wrap;
  }

  function readOnly(text: string): HTMLElement {
    const value = document.createElement('span');
    value.className = 'props-value-read';
    value.textContent = text;
    return value;
  }

  /** The note's other names, as one line of comma-separated words. */
  function aliasBox(note: Note): HTMLElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'props-value';
    input.dataset.valueFor = 'aliases';
    input.setAttribute('aria-label', 'Other names for this note');
    input.placeholder = 'Doggo, Woofer';
    input.value = (note.aliases ?? []).join(', ');
    const commit = (): void => {
      const next = input.value
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (next.join(' ') === (note.aliases ?? []).join(' ')) return;
      host.writeAliases(note.id, next);
      host.status(next.length === 0 ? 'Other names cleared' : `Also known as ${next.join(', ')}`, 3000);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        input.value = (note.aliases ?? []).join(', ');
      }
    });
    input.addEventListener('blur', commit);
    return input;
  }

  function propertyRow(note: Note, prop: NoteProperty, card: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'props-row';
    row.setAttribute('role', 'listitem');
    const key = document.createElement('span');
    key.className = 'props-key';
    const name = document.createElement('span');
    name.className = 'props-key-name';
    name.textContent = prop.key;
    key.append(name);
    const held = (note.properties ?? []).filter((p) => p.key === prop.key);
    if (held.length > 1) {
      // Under the key rather than across the row: it says something about
      // this key, and a row that reflowed would read as a different property.
      const mark = document.createElement('span');
      mark.className = 'props-dup u';
      mark.textContent = `${prop.occurrence} of ${held.length}`;
      key.append(mark);
    }
    row.append(key);

    if (prop.complex) row.append(complexValue(prop));
    else if (Array.isArray(prop.value)) row.append(listValue(note, prop, card));
    else row.append(scalarValue(note, prop, card));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'props-remove u';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      void change(note.id, { key: prop.key, occurrence: prop.occurrence }, card, `Removed ${prop.key}`);
    });
    row.append(remove);
    return row;
  }

  /** YAML the app can show but not edit: its own lines, and nothing else offered. */
  function complexValue(prop: NoteProperty): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'props-complex';
    const said = document.createElement('span');
    said.className = 'props-type u';
    said.textContent = 'complex';
    const pre = document.createElement('pre');
    pre.className = 'props-yaml';
    pre.textContent = 'This value is YAML the sheet does not edit. It is kept exactly as written.';
    wrap.append(said, pre);
    return wrap;
  }

  function scalarValue(note: Note, prop: NoteProperty, card: HTMLElement): HTMLElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'props-value';
    input.setAttribute('aria-label', `Value of ${prop.key}`);
    input.dataset.valueFor = prop.key;
    input.value = prop.value === null ? 'null' : String(prop.value);
    const commit = (): void => {
      const typed = input.value;
      if (typed === (prop.value === null ? 'null' : String(prop.value))) return;
      void change(note.id, { key: prop.key, value: typedValue(typed), occurrence: prop.occurrence }, card, `Set ${prop.key}`);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        input.value = prop.value === null ? 'null' : String(prop.value);
      }
    });
    input.addEventListener('blur', commit);
    return input;
  }

  function listValue(note: Note, prop: NoteProperty, card: HTMLElement): HTMLElement {
    const items = [...(prop.value as PropertyScalar[])];
    const wrap = document.createElement('div');
    wrap.className = 'props-items';
    const write = (next: PropertyScalar[]): void => {
      void change(note.id, { key: prop.key, value: next, occurrence: prop.occurrence }, card, `Set ${prop.key}`);
    };
    items.forEach((item, i) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'props-value props-item';
      input.setAttribute('aria-label', `${prop.key}, item ${i + 1}`);
      if (i === 0) input.dataset.valueFor = prop.key;
      input.value = item === null ? 'null' : String(item);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Enter on an item makes the next one; on the last, it adds one.
          const next = items.map((v, j) => (j === i ? typedValue(input.value) : v));
          next.splice(i + 1, 0, '');
          write(next);
        } else if (e.key === 'Backspace' && input.value === '' && items.length > 1) {
          e.preventDefault();
          write(items.filter((_, j) => j !== i));
        } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const to = i + (e.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= items.length) return;
          const next = [...items];
          [next[i], next[to]] = [next[to], next[i]];
          write(next);
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          input.value = item === null ? 'null' : String(item);
        }
      });
      input.addEventListener('blur', () => {
        if (typedValue(input.value) === item) return;
        write(items.map((v, j) => (j === i ? typedValue(input.value) : v)));
      });
      wrap.append(input);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'props-add-item u';
    add.textContent = 'Add item';
    add.addEventListener('click', () => write([...items, '']));
    wrap.append(add);
    return wrap;
  }

  /** The row that starts a new property, with the notebook's own words offered. */
  function addRow(note: Note, card: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'props-add';
    if (!adding) {
      const start = document.createElement('button');
      start.type = 'button';
      start.className = 'props-start';
      start.textContent = 'Add property';
      start.addEventListener('click', () => {
        adding = { key: '', value: '' };
        drawNote(card);
        card.querySelector<HTMLInputElement>('.props-new-key')?.focus();
      });
      wrap.append(start);
      return wrap;
    }
    const key = document.createElement('input');
    key.type = 'text';
    key.className = 'props-value props-new-key';
    key.placeholder = 'Property name';
    key.setAttribute('aria-label', 'New property name');
    key.value = adding.key;
    const value = document.createElement('input');
    value.type = 'text';
    value.className = 'props-value props-new-value';
    value.placeholder = 'Value';
    value.setAttribute('aria-label', 'New property value');
    value.value = adding.value;
    const list = document.createElement('div');
    list.className = 'props-complete';

    const vocabulary = propertyVocabulary(host.notes());
    const drawComplete = (): void => {
      list.innerHTML = '';
      if (!adding) return;
      for (const use of completeKey(vocabulary, adding.key, 6)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'props-complete-row';
        const name = document.createElement('span');
        name.textContent = use.key;
        const count = document.createElement('span');
        count.className = 'props-count u';
        count.textContent = `${use.noteCount} ${use.noteCount === 1 ? 'note' : 'notes'}${use.casingVariants.length > 0 ? ' · also spelled otherwise' : ''}`;
        row.append(name, count);
        row.addEventListener('click', () => {
          if (adding) adding.key = use.key;
          key.value = use.key;
          value.focus();
          drawComplete();
        });
        list.append(row);
      }
    };
    key.addEventListener('input', () => {
      if (adding) adding.key = key.value;
      drawComplete();
    });
    value.addEventListener('input', () => {
      if (adding) adding.value = value.value;
    });
    const commit = (): void => {
      const name = key.value.trim();
      if (!name) return;
      if (!SIMPLE_KEY.test(name)) {
        host.status(`“${name}” is not a name a property can have — letters, digits, - and _`, 4000);
        return;
      }
      adding = null;
      void change(note.id, { key: name, value: typedValue(value.value) }, card, `Added ${name}`);
    };
    for (const box of [key, value]) {
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (box === key) value.focus();
          else commit();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          adding = null;
          drawNote(card);
        }
      });
    }
    wrap.append(key, value, list);
    drawComplete();
    return wrap;
  }

  async function change(id: string, what: { key: string; value?: PropertyValue; occurrence?: number }, card: HTMLElement, said: string): Promise<void> {
    const failed = await host.write(id, what);
    if (failed) {
      host.status(failed, 4000);
      return;
    }
    host.status(`${said} · Ctrl+Z undoes it`, 3000);
    if (sheet && mode === 'note') drawNote(card);
  }

  // --- the notebook's vocabulary ---------------------------------------------

  function openVocabulary(): void {
    mode = 'vocabulary';
    openId = null;
    filter = '';
    const el = shell('All properties');
    const card = document.createElement('div');
    card.className = 'sheet-card props-card vocab-card';
    card.tabIndex = -1;
    el.append(card);
    drawVocabulary(card);
    card.focus();
  }

  function drawVocabulary(card: HTMLElement): void {
    const vocabulary = propertyVocabulary(host.notes());
    card.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.textContent = 'All properties';
    card.append(h2);

    if (vocabulary.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'props-empty';
      empty.textContent = 'No note in this notebook carries a property yet.';
      card.append(empty);
    }

    const list = document.createElement('div');
    list.className = 'vocab-list';
    for (const use of vocabulary) list.append(vocabularyRow(use, card));
    card.append(list);

    const foot = document.createElement('p');
    foot.className = 'sheet-foot u';
    foot.innerHTML = 'Choosing a key searches for it · <kbd>Esc</kbd> closes';
    card.append(foot);
  }

  function vocabularyRow(use: PropertyUse, card: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'vocab-key';
    key.textContent = use.key;
    key.addEventListener('click', () => {
      host.search(`prop:${quoted(use.key)}`);
      close();
    });
    const count = document.createElement('span');
    count.className = 'vocab-count u';
    const notes = `${use.noteCount} ${use.noteCount === 1 ? 'note' : 'notes'}`;
    const extra = [use.types.join(' · '), use.duplicateCount > 0 ? `written twice in ${use.duplicateCount} of them` : '', use.casingVariants.length > 0 ? `also ${use.casingVariants.join(', ')}` : ''].filter(Boolean);
    count.textContent = `${notes} · ${extra.join(' · ')}`;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'vocab-more u';
    more.textContent = unfolded.has(use.key) ? 'Hide values' : 'Values';
    more.hidden = use.values.length === 0;
    more.addEventListener('click', () => {
      if (unfolded.has(use.key)) unfolded.delete(use.key);
      else unfolded.add(use.key);
      drawVocabulary(card);
    });
    row.append(key, count, more);
    if (unfolded.has(use.key)) row.append(valueList(use, card));
    return row;
  }

  /** A key's values: the ten commonest, then a box for finding the rest. */
  function valueList(use: PropertyUse, card: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vocab-values';
    const want = filter.trim().toLowerCase();
    const shown = (want ? use.values.filter((v) => v.text.toLowerCase().includes(want)) : use.values.slice(0, 10)).slice(0, 50);
    if (use.values.length > 10) {
      const box = document.createElement('input');
      box.type = 'text';
      box.className = 'vocab-filter';
      box.placeholder = `Find one of ${use.values.length} values`;
      box.setAttribute('aria-label', `Find a value of ${use.key}`);
      box.value = filter;
      box.addEventListener('input', () => {
        filter = box.value;
        drawVocabulary(card);
        card.querySelector<HTMLInputElement>('.vocab-filter')?.focus();
      });
      wrap.append(box);
    }
    for (const value of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vocab-value';
      const said = document.createElement('span');
      said.textContent = value.text;
      const count = document.createElement('span');
      count.className = 'vocab-count u';
      count.textContent = String(value.noteCount);
      row.append(said, count);
      row.addEventListener('click', () => {
        host.search(`prop:${quoted(`${use.key}=${value.text}`)}`);
        close();
      });
      wrap.append(row);
    }
    return wrap;
  }

  return {
    open,
    openVocabulary,
    isOpen: () => sheet !== null,
    close,
    refresh: () => {
      const card = sheet?.querySelector<HTMLElement>('.sheet-card');
      if (!card) return;
      if (mode === 'note') drawNote(card);
      else drawVocabulary(card);
    },
  };
}

/** What was typed, read the same conservative way the file is read. */
function typedValue(typed: string): PropertyScalar {
  const text = typed.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const asNumber = Number(text);
  if (text !== '' && Number.isFinite(asNumber) && String(asNumber) === text) return asNumber;
  return typed;
}

/** An operand that needs quoting in the search box, quoted. */
const quoted = (operand: string): string => (/\s/.test(operand) ? `"${operand.replace(/"/g, '')}"` : operand);

/** A key made safe to put in a selector. */
const cssEscape = (text: string): string => text.replace(/["\\]/g, '\\$&');

/** What the sheet says a value is, for anything that wants to name a type. */
export const describeValue = (prop: NoteProperty): string => `${typeOfValue(prop.value, prop.complex)}${prop.complex ? '' : ` · ${Array.isArray(prop.value) ? prop.value.map(writeScalar).join(', ') : writeScalar(prop.value)}`}`;
