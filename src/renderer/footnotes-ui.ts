import { scanFootnotes, withDefinitionText, withInlineText, withNewDefinition, type FootnoteDef, type FootnoteEntry, type FootnoteScan, type InlineNote } from '../shared/footnotes';

/**
 * The footnotes rail: the note's footnotes listed beside it, under the
 * outline, to jump by and to edit without losing your place.
 *
 * Rows are the footnotes as the preview numbers them, then the definitions
 * nothing refers to, then the ids nothing defines. A number goes to the
 * reference nearest where you were; the words open in a small editor right
 * here, and the document's caret and scroll stay exactly where they were
 * until **↩ Back** puts you there again. Every commit is one document edit
 * and one step to undo; nothing is written while typing.
 */

/** Where the writer was in the note before the rail was touched. */
export interface FocusState {
  anchor: number;
  focus: number;
  scrollTop: number;
}

export interface FootnotesHost {
  /** The body of the note on screen, or null with no note. */
  body(): string | null;
  preview(): boolean;
  /** Whether the rail is wanted at all (the Footnotes command). */
  enabled(): boolean;
  /** Whether the pane is showing a note's page at all. */
  pageShown(): boolean;
  /** The document caret and scroll, to come back to. */
  capture(): FocusState;
  restore(state: FocusState): void;
  /** Puts the caret at an offset of the body, unfolding whatever hides it, and scrolls there. */
  goTo(offset: number): void;
  /** Scrolls the preview to an element matched by a selector, or to the first text run holding `text`. */
  scrollPreview(selector: string | null, text?: string): void;
  /** Rewrites the body as one edit. The document caret, if it is after the change, is moved by the difference. */
  setBody(next: string): void;
  status(message: string): void;
  root: HTMLElement;
}

export interface FootnotesRail {
  /** Draws the rail for the note on screen. True when it has something to show. */
  render(): boolean;
  /** Whether a row's editor is open. */
  isEditing(): boolean;
  /** Commits an open editor, if any. */
  commit(): void;
  /** Leaves the rail: commits, restores the writer's place. */
  back(): void;
}

/** The text shown for a definition: its first characters, one paragraph, no markdown taken off. */
const excerpt = (text: string): string => text.replace(/\s+/g, ' ').trim() || '…';

/** Which reference of a footnote to go to: the nearest to `from`, the one after it on a tie. */
export function nearestRef(offsets: readonly number[], from: number): number {
  let best = offsets[0] ?? 0;
  let bestDistance = Infinity;
  for (const at of offsets) {
    const d = Math.abs(at - from);
    if (d < bestDistance || (d === bestDistance && at > best)) {
      best = at;
      bestDistance = d;
    }
  }
  return best;
}

/** The offset of a line and column in a body. */
export function offsetOfLineCol(body: string, line: number, col: number): number {
  const lines = body.split('\n');
  let at = 0;
  for (let i = 0; i < line && i < lines.length; i++) at += lines[i].length + 1;
  return at + col;
}

/** An offset in the old text carried across an edit: unchanged before the change, moved by the difference after it. */
export function mapOffset(before: string, after: string, offset: number): number {
  let common = 0;
  const max = Math.min(before.length, after.length);
  while (common < max && before[common] === after[common]) common++;
  if (offset <= common) return offset;
  return Math.max(common, offset + (after.length - before.length));
}

export function createFootnotesRail(host: FootnotesHost): FootnotesRail {
  let scan: FootnoteScan | null = null;
  let body = '';
  /** The row being edited, and how to leave it. */
  let editing: { area: HTMLTextAreaElement; save: () => void; cancel: () => void } | null = null;
  /** Where the writer was before the rail took the focus, mapped through every edit since. */
  let saved: FocusState | null = null;
  /** After a Create definition, the id whose editor should open once the rail is redrawn. */
  let openNext: string | null = null;

  const button = (cls: string, text: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.title = title;
    return b;
  };

  /** Remembers the writer's place the first time the rail is used, so Back has somewhere to go. */
  function hold(): void {
    if (!saved) saved = host.capture();
    backButton.hidden = false;
  }

  /** Applies a rewrite, keeping the remembered place in step with it. */
  function write(next: string): void {
    if (next === body) return;
    if (saved) saved = { anchor: mapOffset(body, next, saved.anchor), focus: mapOffset(body, next, saved.focus), scrollTop: saved.scrollTop };
    host.setBody(next);
  }

  const backButton = button('fn-back u', '↩ Back', 'Back to where you were writing');
  backButton.hidden = true;
  backButton.addEventListener('click', () => back());

  function back(): void {
    commit();
    if (saved) host.restore(saved);
    saved = null;
    backButton.hidden = true;
  }

  function commit(): void {
    editing?.save();
  }

  /** Opens the editor for a definition's words, in place of the row's text. */
  function edit(row: HTMLElement, textEl: HTMLElement, current: string, single: boolean, apply: (text: string) => string): void {
    if (host.preview()) return;
    commit();
    hold();
    const area = document.createElement('textarea');
    area.className = `fn-edit${single ? ' fn-edit-single' : ''}`;
    area.value = current;
    area.rows = single ? 1 : Math.min(8, Math.max(2, current.split('\n').length + 1));
    area.setAttribute('aria-label', 'Footnote text');
    area.spellcheck = true;
    textEl.replaceWith(area);
    row.classList.add('editing');
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      editing = null;
      const value = area.value;
      area.replaceWith(textEl);
      row.classList.remove('editing');
      if (save && value !== current) write(apply(value));
    };
    editing = { area, save: () => finish(true), cancel: () => finish(false) };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        backButton.focus();
      } else if (e.key === 'Enter' && (e.ctrlKey || single)) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
        backButton.focus();
      }
    });
    area.addEventListener('blur', () => finish(true));
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function rowFor(entry: FootnoteEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = `fn-row fn-${entry.kind}`;
    row.dataset.number = String(entry.number);
    const num = button('fn-num', String(entry.number), 'Go to the reference');
    num.setAttribute('aria-label', `Footnote ${entry.number}: go to its reference`);
    num.addEventListener('click', () => {
      commit();
      if (host.preview()) {
        host.scrollPreview(`.footnote-ref a[data-footnote="${entry.number}"]`);
        return;
      }
      hold();
      const from = saved?.focus ?? 0;
      const offsets = entry.kind === 'named' ? entry.refs.map((r) => offsetOfLineCol(body, r.line, r.col)) : [offsetOfLineCol(body, entry.note.line, entry.note.col)];
      host.goTo(nearestRef(offsets, from));
    });
    row.append(num);
    const head = document.createElement('span');
    head.className = 'fn-head';
    if (entry.kind === 'named') {
      if (!/^\d+$/.test(entry.id)) {
        const id = document.createElement('span');
        id.className = 'fn-id';
        id.textContent = `[^${entry.id}]`;
        head.append(id);
      }
    } else {
      const kind = document.createElement('span');
      kind.className = 'fn-kind u';
      kind.textContent = 'Inline';
      head.append(kind);
    }
    const text = button('fn-text', excerpt(entry.kind === 'named' ? entry.def.text : entry.note.text), host.preview() ? 'Go to the footnote' : 'Edit the footnote here');
    text.addEventListener('click', () => {
      if (host.preview()) {
        commit();
        host.scrollPreview(`.footnotes-list li:nth-child(${entry.number})`);
        return;
      }
      if (entry.kind === 'named') edit(row, text, entry.def.text, false, (v) => withDefinitionText(body, entry.def, v));
      else edit(row, text, entry.note.text, true, (v) => withInlineText(body, entry.note as InlineNote, v));
    });
    const words = document.createElement('div');
    words.className = 'fn-words';
    if (head.childNodes.length > 0) words.append(head);
    words.append(text);
    row.append(words);
    return row;
  }

  function unreferencedRow(def: FootnoteDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fn-row fn-unreferenced';
    const id = button('fn-id fn-id-btn', `[^${def.id}]`, 'Go to the definition');
    id.addEventListener('click', () => {
      commit();
      if (host.preview()) {
        host.scrollPreview(null, `[^${def.id}]:`);
        return;
      }
      hold();
      host.goTo(offsetOfLineCol(body, def.start, 0));
    });
    const text = button('fn-text', excerpt(def.text), host.preview() ? 'Go to the definition' : 'Edit the footnote here');
    text.addEventListener('click', () => {
      if (host.preview()) {
        commit();
        host.scrollPreview(null, `[^${def.id}]:`);
        return;
      }
      edit(row, text, def.text, false, (v) => withDefinitionText(body, def, v));
    });
    const words = document.createElement('div');
    words.className = 'fn-words';
    const head = document.createElement('span');
    head.className = 'fn-head';
    const note = document.createElement('span');
    note.className = 'fn-kind u';
    note.textContent = 'Not referenced';
    head.append(note);
    words.append(head, text);
    row.append(id, words);
    return row;
  }

  function undefinedRow(id: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fn-row fn-undefined';
    const idBtn = button('fn-id fn-id-btn', `[^${id}]`, 'Go to the reference');
    idBtn.addEventListener('click', () => {
      commit();
      if (host.preview()) {
        host.scrollPreview(null, `[^${id}]`);
        return;
      }
      hold();
      const ref = scan?.refs.find((r) => r.id === id);
      if (ref) host.goTo(offsetOfLineCol(body, ref.line, ref.col));
    });
    const words = document.createElement('div');
    words.className = 'fn-words';
    const none = document.createElement('span');
    none.className = 'fn-none';
    none.textContent = 'No definition';
    const create = button('fn-create u', 'Create definition', 'Add a [^id]: line at the end of the note and write it here');
    create.disabled = host.preview();
    create.addEventListener('click', () => {
      commit();
      hold();
      openNext = id;
      write(withNewDefinition(body, id).body);
    });
    words.append(none, create);
    row.append(idBtn, words);
    return row;
  }

  function render(): boolean {
    // A redraw under an open editor would take the editor away mid-word.
    if (editing) return !host.root.hidden;
    const text = host.body();
    const show = text !== null && host.enabled() && host.pageShown();
    scan = show ? scanFootnotes(text) : null;
    body = text ?? '';
    const rows = scan ? scan.entries.length + scan.unreferenced.length + scan.undefined.length : 0;
    host.root.hidden = !show || rows === 0;
    if (host.root.hidden) {
      host.root.replaceChildren();
      if (!saved) backButton.hidden = true;
      return false;
    }
    const label = document.createElement('span');
    label.className = 'footnotes-rail-label u';
    label.textContent = 'Footnotes';
    const list = document.createElement('div');
    list.className = 'fn-list';
    for (const entry of scan!.entries) list.append(rowFor(entry));
    for (const def of scan!.unreferenced) list.append(unreferencedRow(def));
    for (const id of scan!.undefined) list.append(undefinedRow(id));
    host.root.replaceChildren(label, list, backButton);
    if (openNext) {
      const id = openNext;
      openNext = null;
      const def = scan!.defs.find((d) => d.id === id);
      const row = def ? Array.from(list.querySelectorAll<HTMLElement>('.fn-row')).find((r) => r.querySelector('.fn-id')?.textContent === `[^${id}]` || (/^\d+$/.test(id) && r.dataset.number && scan!.entries[Number(r.dataset.number) - 1]?.kind === 'named' && (scan!.entries[Number(r.dataset.number) - 1] as { id: string }).id === id)) : null;
      const textEl = row?.querySelector<HTMLElement>('.fn-text');
      if (def && row && textEl) edit(row, textEl, def.text, false, (v) => withDefinitionText(body, def, v));
    }
    return true;
  }

  return { render, isEditing: () => editing !== null, commit, back };
}
