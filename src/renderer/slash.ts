import { keyLabel } from '../shared/keys';
import { place, type AnchorBox } from './anchored';

/**
 * The `/` menu.
 *
 * This is the fifth surface to read the one `ACTIONS` registry, and it earns
 * its place on one distinction:
 *
 * > The palette answers "what can Notes do?" Slash commands answer "what can
 * > Notes insert here?"
 *
 * Which is why the membership is only the insert-shaped commands, why the
 * standing "no formatting commands" is untouched by it, and why the editor
 * keeps the keyboard focus throughout — the caret never moves, and the `/`
 * and everything typed after it stay ordinary characters in the note until a
 * command actually runs. Esc leaves them there; so does clicking away, a
 * newline, or carrying on past a word that matches nothing.
 */

/** One row of the menu: a command that inserts something at the caret. */
export interface SlashItem {
  id: string;
  label: string;
  hint?: string;
  terms?: string;
  chord?: string;
  run: () => void;
}

export interface SlashHost {
  /** The commands that may appear, in registry order. */
  items(): SlashItem[];
  /** The line the caret is on, and where in it — the whole session is read from this. */
  caret(): { line: string; column: number } | null;
  /** Where the caret is on screen, for the anchor. */
  caretBox(): AnchorBox | null;
  /** Takes the `/query` out of the note as one edit, then runs the command. */
  runWith(queryLength: number, run: () => void): void;
  root: HTMLElement;
}

export interface Slash {
  /**
   * Something was typed. Opens the menu on a `/` that starts a line or
   * follows whitespace, keeps it in step with what is typed after, and closes
   * it when the query stops making sense. True while it is open.
   */
  sync(): boolean;
  /** A key the menu wants: Up, Down, Enter, Tab, Escape. True when it took it. */
  key(e: KeyboardEvent): boolean;
  /** Closes it, leaving whatever was typed in the note. True when there was one. */
  close(): boolean;
  isOpen(): boolean;
  /** Holds the session open while a chooser of its own has the focus. */
  suspend(): void;
  resume(): void;
  /** For tests: the rows as they now read. */
  shown(): string[];
}

/**
 * Where a `/` session starts on a line, or -1.
 *
 * Only at the beginning, or after whitespace — never mid-word, so `and/or`
 * and a path typed into a note are left alone. The query runs to the caret
 * and may hold spaces; a newline has already ended the line.
 */
export function sessionStart(line: string, column: number): number {
  for (let i = column - 1; i >= 0; i--) {
    const c = line[i];
    if (c === '/') return i === 0 || /\s/.test(line[i - 1]) ? i : -1;
    // A second slash, or something that is plainly not a query, ends the search.
    if (c === '\n') return -1;
  }
  return -1;
}

/** Whether a line's `/` at this column is inside inline code. */
export function inInlineCode(line: string, column: number): boolean {
  let ticks = 0;
  for (let i = 0; i < column; i++) if (line[i] === '`') ticks++;
  return ticks % 2 === 1;
}

/** True when a line is a row of a markdown table, where `/` is just a character. */
export const inTableRow = (line: string): boolean => line.trim().startsWith('|') || /\|.*\|/.test(line);

/** The rows a query keeps, in registry order — the order the menus are built in. */
export function matchSlash(items: readonly SlashItem[], query: string): SlashItem[] {
  const want = query.trim().toLowerCase();
  if (!want) return [...items];
  return items.filter((item) => `${item.label} ${item.hint ?? ''} ${item.terms ?? ''}`.toLowerCase().includes(want));
}

export function createSlash(host: SlashHost): Slash {
  let menu: HTMLElement | null = null;
  let at = 0;
  let query = '';
  let shownItems: SlashItem[] = [];
  /** True while a chooser of the menu's own has the focus and must not dismiss it. */
  let suspended = false;

  function close(): boolean {
    if (!menu) return false;
    menu.remove();
    menu = null;
    at = 0;
    query = '';
    shownItems = [];
    suspended = false;
    return true;
  }

  function draw(): void {
    if (!menu) return;
    menu.replaceChildren();
    if (shownItems.length === 0) {
      const said = document.createElement('p');
      said.className = 'slash-empty u';
      said.textContent = 'No matching insert command';
      menu.append(said);
      return;
    }
    shownItems.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `slash-row${i === at ? ' at' : ''}`;
      row.id = `slash-row-${i}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === at));
      const label = document.createElement('span');
      label.className = 'slash-label';
      label.textContent = item.label;
      const keys = document.createElement('span');
      keys.className = 'slash-keys';
      // 0.21.0's rule holds here too: a command surface prints the chord
      // beside the command, every time it is used.
      if (item.chord) for (const part of keyLabel(item.chord)) {
        const k = document.createElement('kbd');
        k.textContent = part;
        keys.append(k);
      }
      row.append(label, keys);
      row.addEventListener('mousedown', (e) => {
        // mousedown, not click: a click would blur the editor first.
        e.preventDefault();
        choose(i);
      });
      menu?.append(row);
    });
    const active = menu.querySelector('.slash-row.at');
    // Guarded: jsdom has no scrolling, and neither does a menu short enough
    // not to need any.
    active?.scrollIntoView?.({ block: 'nearest' });
  }

  function position(): void {
    if (!menu) return;
    const box = host.caretBox();
    if (!box) return;
    const size = { width: menu.offsetWidth, height: menu.offsetHeight };
    const view = { width: window.innerWidth, height: window.innerHeight };
    // Under the query where there is room, above it where there is not.
    const spot = place({ ...box, right: box.left }, size, view, { gap: 6 });
    menu.style.left = `${spot.left}px`;
    menu.style.top = `${spot.top}px`;
  }

  function open(): void {
    const el = document.createElement('div');
    el.className = 'slash';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Insert');
    el.style.position = 'fixed';
    host.root.append(el);
    menu = el;
    at = 0;
  }

  function sync(): boolean {
    if (suspended) return menu !== null;
    const here = host.caret();
    if (!here) return close() && false;
    const { line, column } = here;
    const start = sessionStart(line, column);
    // Never inside code, never in a table row: there a slash is a character.
    if (start < 0 || inInlineCode(line, start) || inTableRow(line)) {
      close();
      return false;
    }
    query = line.slice(start + 1, column);
    shownItems = matchSlash(host.items(), query);
    if (!menu) open();
    if (at >= shownItems.length) at = Math.max(0, shownItems.length - 1);
    draw();
    position();
    return true;
  }

  function choose(i: number): void {
    const item = shownItems[i];
    if (!item) return;
    const typed = query.length + 1;
    close();
    // The `/query` and whatever the command inserts are one edit, so one
    // Ctrl+Z puts the query back exactly as it was typed.
    host.runWith(typed, item.run);
  }

  function key(e: KeyboardEvent): boolean {
    if (!menu) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shownItems.length === 0) return true;
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shownItems.length) % shownItems.length;
      draw();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (shownItems.length === 0) return false;
      e.preventDefault();
      choose(at);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Esc closes the menu and leaves the query: it is the note's own text.
      close();
      return true;
    }
    return false;
  }

  return {
    sync,
    key,
    close,
    isOpen: () => menu !== null,
    suspend: () => {
      suspended = true;
    },
    resume: () => {
      suspended = false;
    },
    shown: () => shownItems.map((i) => i.label),
  };
}
